import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { IncidentStore, type Incident } from "../src/incidents.js";

describe("IncidentStore", () => {
  it("returns indexed incidents newest first", async () => {
    const incident = { id: "42:abc", createdAt: "2026-09-28T10:00:00.000Z", reason: "blocked", diff: "+secret", job: { repoId: "42", owner: "owner", repo: "repo", sha: "abc", installationId: 1, ref: "refs/heads/main" } } satisfies Incident;
    const values = new Map<string, string>();
    const index: string[] = [];
    const transaction = {
      set(key: string, value: string) { values.set(key, value); return this; },
      zadd(_key: string, _score: number, sha: string) { index.unshift(sha); return this; },
      async exec() { return []; }
    };
    const redis = {
      multi: () => transaction,
      zrevrange: async () => index,
      mget: async (keys: string[]) => keys.map(key => values.get(key) ?? null)
    } as unknown as Redis;

    const store = new IncidentStore(redis);
    await store.save(incident);
    expect(await store.list("42")).toEqual([incident]);
  });
});
