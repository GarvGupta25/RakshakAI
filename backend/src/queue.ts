import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";

export interface PushJob {
  repoId: string;
  owner: string;
  repo: string;
  sha: string;
  installationId: number;
  ref: string;
}

export const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
export const pushQueue = new Queue<PushJob>("push-analysis", { connection });

export const analysisJobId = (job: Pick<PushJob, "repoId" | "sha">, rerunNonce?: number) =>
  `${job.repoId}:${job.sha}${rerunNonce === undefined ? "" : `:${rerunNonce}`}`;

export async function enqueuePush(job: PushJob, rerun = false) {
  return pushQueue.add("analyze-push", job, {
    jobId: analysisJobId(job, rerun ? Date.now() : undefined),
    removeOnComplete: 1000,
    removeOnFail: 1000
  });
}
