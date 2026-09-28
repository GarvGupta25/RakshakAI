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
const indexKey = (repoId: string) => `agentguard:repo:${repoId}:incidents`;

export class IncidentStore {
  constructor(private readonly redis: Redis) {}
  async save(incident: Incident) {
    await this.redis.multi()
      .set(key(incident.job.repoId, incident.job.sha), JSON.stringify(incident))
      .zadd(indexKey(incident.job.repoId), Date.parse(incident.createdAt), incident.job.sha)
      .exec();
  }
  async get(repoId: string, sha: string): Promise<Incident | null> {
    const data = await this.redis.get(key(repoId, sha));
    return data ? JSON.parse(data) as Incident : null;
  }
  async list(repoId: string, limit = 20): Promise<Incident[]> {
    const shas = await this.redis.zrevrange(indexKey(repoId), 0, Math.max(0, limit - 1));
    if (!shas.length) return [];
    const incidents = await this.redis.mget(shas.map(sha => key(repoId, sha)));
    return incidents.filter((item): item is string => Boolean(item)).map(item => JSON.parse(item) as Incident);
  }
}
