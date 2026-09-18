import { Worker } from "bullmq";
import { classifyDiff } from "./classification.js";
import { getCommitDiff } from "./github.js";
import { RepoLock } from "./lock.js";
import { connection, type PushJob } from "./queue.js";
import { scanDiffInSandbox } from "./sandbox.js";
import { RepoStateStore } from "./state.js";

const locks = new RepoLock(connection);
const state = new RepoStateStore(connection);

export const worker = new Worker<PushJob>("push-analysis", async job => {
  const release = await locks.acquire(job.data.repoId);
  try {
    const diff = await getCommitDiff(job.data);
    const scan = await scanDiffInSandbox(diff);
    if (scan.secretsFound) {
      await state.updateRepoState(job.data.repoId, { last_scanned_commit_sha: job.data.sha });
      return { route: "remediate", reason: "secret_detected" };
    }
    const classification = classifyDiff(diff);
    if (classification === "style_only") return { route: "auto_correct", classification };
    return { route: "llm_review", classification, context: await state.getRelevantContext(job.data.repoId, diff) };
  } finally { await release(); }
}, { connection });

worker.on("failed", (job, error) => console.error("Analysis job failed", job?.id, error));
