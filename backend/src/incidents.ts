import type { Redis } from "ioredis";
import type { PushJob } from "./queue.js";
import type { FinalVerdict } from "./llm.js";

export interface Incident {
  id: string;
  job: PushJob;
  diff: string;
  createdAt: string;
  reason: string;
  verdict?: FinalVerdict;
}

const key = (repoId: string, sha: string) => `agentguard:incident:${repoId}:${sha}`;

export class IncidentStore {
  constructor(private readonly redis: Redis) {}
  async save(incident: Incident) { await this.redis.set(key(incident.job.repoId, incident.job.sha), JSON.stringify(incident)); }
  async get(repoId: string, sha: string): Promise<Incident | null> {
    const data = await this.redis.get(key(repoId, sha));
    return data ? JSON.parse(data) as Incident : null;
  }
}
