import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

export class RepoLock {
  constructor(private readonly redis: Redis) {}

  async acquire(repoId: string, ttlMs = 300_000): Promise<() => Promise<void>> {
    const key = `agentguard:repo:${repoId}:lock`;
    const token = randomUUID();
    const acquired = await this.redis.set(key, token, "PX", ttlMs, "NX");
    if (acquired !== "OK") throw new Error(`Repository ${repoId} is already being processed`);
    return async () => {
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, key, token);
    };
  }
}
