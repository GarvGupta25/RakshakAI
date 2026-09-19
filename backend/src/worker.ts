import { Worker } from "bullmq";
import { classifyDiff } from "./classification.js";
import { getCommitDiff } from "./github.js";
import { RepoLock } from "./lock.js";
import { connection, type PushJob } from "./queue.js";
import { scanDiffInSandbox } from "./sandbox.js";
import { RepoStateStore, deriveHealthScore, filesFromDiff } from "./state.js";
import { callCheapModel, callReasoningModel } from "./llm.js";
import { setCommitCheck } from "./github.js";
import { DiscordNotifier } from "./notifications.js";
import { IncidentStore } from "./incidents.js";
import { applySafeCorrection } from "./corrections.js";
import { remediateBlockedChange } from "./remediation.js";

const locks = new RepoLock(connection);
const state = new RepoStateStore(connection);
const notifier = new DiscordNotifier();
const incidents = new IncidentStore(connection);

export const worker = new Worker<PushJob>("push-analysis", async job => {
  const release = await locks.acquire(job.data.repoId);
  try {
    const diff = await getCommitDiff(job.data);
    const priorState = await state.getRepoState(job.data.repoId);
    const knownFiles = [...new Set([...priorState.known_file_list, ...filesFromDiff(diff)])].slice(-5_000);
    const scan = await scanDiffInSandbox(diff);
    if (scan.secretsFound) {
      await state.updateRepoState(job.data.repoId, { known_file_list: knownFiles });
      await incidents.save({ id: `${job.data.repoId}:${job.data.sha}`, job: job.data, diff, createdAt: new Date().toISOString(), reason: "Potential credential detected in the actual patch." });
      await setCommitCheck(job.data, "failure", "Potential credential detected. The change requires human review.");
      await notifier.sendNotification({ repo: `${job.data.owner}/${job.data.repo}`, sha: job.data.sha, summary: "Potential credential detected in the actual patch.", explainUrl: `/explain?repo=${job.data.repoId}&sha=${job.data.sha}` });
      return { route: "remediate", reason: "secret_detected", remediation: await remediateBlockedChange(job.data, priorState.last_scanned_commit_sha) };
    }
    const classification = classifyDiff(diff);
    if (classification === "style_only") {
      const correction = await applySafeCorrection(job.data);
      await state.updateRepoState(job.data.repoId, { last_scanned_commit_sha: job.data.sha, known_file_list: knownFiles, auto_corrections_applied: priorState.auto_corrections_applied + Number(correction.applied) });
      await setCommitCheck(job.data, "success", correction.reason);
      return { route: "auto_correct", classification, correction };
    }
    const context = await state.getRelevantContext(job.data.repoId, diff);
    const cheap = await callCheapModel(diff, context);
    if (cheap.risk_level === "safe") {
      await state.updateRepoState(job.data.repoId, { last_scanned_commit_sha: job.data.sha, known_file_list: knownFiles });
      await setCommitCheck(job.data, "success", cheap.reason);
      return { route: "allow", classification, cheap };
    }
    const final = await callReasoningModel(diff, context);
    const recent_verdicts = [...priorState.recent_verdicts, { commit_sha: job.data.sha, risk_level: cheap.risk_level, verdict: final.verdict, timestamp: new Date().toISOString() }].slice(-50);
    await state.updateRepoState(job.data.repoId, {
      ...(final.verdict !== "block" ? { last_scanned_commit_sha: job.data.sha } : {}),
      known_file_list: knownFiles, recent_verdicts, health_score: deriveHealthScore(recent_verdicts)
    });
    if (final.verdict === "block") {
      await incidents.save({ id: `${job.data.repoId}:${job.data.sha}`, job: job.data, diff, createdAt: new Date().toISOString(), reason: final.human_summary, verdict: final });
      await setCommitCheck(job.data, "failure", final.human_summary);
      await notifier.sendNotification({ repo: `${job.data.owner}/${job.data.repo}`, sha: job.data.sha, summary: final.human_summary, explainUrl: `/explain?repo=${job.data.repoId}&sha=${job.data.sha}` });
    } else await setCommitCheck(job.data, "success", final.human_summary);
    return { route: final.verdict === "block" ? "remediate" : "allow", cheap, final, ...(final.verdict === "block" ? { remediation: await remediateBlockedChange(job.data, priorState.last_scanned_commit_sha) } : {}) };
  } finally { await release(); }
}, { connection });

worker.on("failed", (job, error) => console.error("Analysis job failed", job?.id, error));
