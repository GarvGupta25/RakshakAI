import { describe, expect, it } from "vitest";
import { addTokenUsage, appendVerdict, deriveHealthScore, emptyRepoState, filesFromDiff } from "../src/state.js";

describe("RepoState", () => {
  it("starts with an explicit healthy, empty repository memory", () => {
    expect(emptyRepoState("42")).toMatchObject({ repo_id: "42", health_score: 100, recent_verdicts: [] });
  });
  it("extracts changed paths and penalizes blocked verdicts", () => {
    expect(filesFromDiff("+++ b/src/app.ts\n+++ b/src/app.ts\n+++ b/README.md")).toEqual(["src/app.ts", "README.md"]);
    expect(deriveHealthScore([{ commit_sha: "a", risk_level: "dangerous", verdict: "block", timestamp: "now" }])).toBe(80);
  });
  it("keeps a bounded verdict history and resets daily token usage", () => {
    const verdict = { commit_sha: "a", risk_level: "safe" as const, verdict: "allow" as const, timestamp: "now" };
    expect(appendVerdict(Array(50).fill(verdict), { ...verdict, commit_sha: "latest" })).toHaveLength(50);
    expect(addTokenUsage({ tokens_spent_today: 120, tokens_spent_on: "2026-09-27" }, 30, "2026-09-28")).toEqual({ tokens_spent_today: 30, tokens_spent_on: "2026-09-28" });
  });
});
