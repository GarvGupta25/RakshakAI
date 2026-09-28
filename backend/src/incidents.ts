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
  status?: "open" | "resolved";
  resolvedAt?: string;
  notification?: { channel: "discord"; status: "sent" | "skipped" | "failed"; attemptedAt: string; error?: string };
}

const key = (repoId: string, sha: string) => `agentguard:incident:${repoId}:${sha}`;
const indexKey = (repoId: string) => `agentguard:repo:${repoId}:incidents`;

export class IncidentStore {
  constructor(private readonly redis: Redis) {}
  async save(incident: Incident) {
    const stored = { ...incident, status: incident.status ?? "open" };
    await this.redis.multi()
      .set(key(incident.job.repoId, incident.job.sha), JSON.stringify(stored))
      .zadd(indexKey(incident.job.repoId), Date.parse(incident.createdAt), incident.job.sha)
      .exec();
  }
  async get(repoId: string, sha: string): Promise<Incident | null> {
    const data = await this.redis.get(key(repoId, sha));
    return data ? { status: "open", ...JSON.parse(data) } as Incident : null;
  }
  async list(repoId: string, limit = 20): Promise<Incident[]> {
    const shas = await this.redis.zrevrange(indexKey(repoId), 0, Math.max(0, limit - 1));
    if (!shas.length) return [];
    const incidents = await this.redis.mget(shas.map(sha => key(repoId, sha)));
    return incidents.filter((item): item is string => Boolean(item)).map(item => JSON.parse(item) as Incident);
  }
  async resolve(repoId: string, sha: string): Promise<Incident | null> {
    const incident = await this.get(repoId, sha);
    if (!incident) return null;
    const resolved = { ...incident, status: "resolved" as const, resolvedAt: incident.resolvedAt ?? new Date().toISOString() };
    await this.redis.set(key(repoId, sha), JSON.stringify(resolved));
    return resolved;
  }
  async recordNotification(repoId: string, sha: string, notification: NonNullable<Incident["notification"]>) {
    const incident = await this.get(repoId, sha);
    if (!incident) return;
    await this.redis.set(key(repoId, sha), JSON.stringify({ ...incident, notification }));
  }
}
