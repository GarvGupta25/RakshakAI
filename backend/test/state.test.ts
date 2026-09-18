import { describe, expect, it } from "vitest";
import { deriveHealthScore, emptyRepoState, filesFromDiff } from "../src/state.js";

describe("RepoState", () => {
  it("starts with an explicit healthy, empty repository memory", () => {
    expect(emptyRepoState("42")).toMatchObject({ repo_id: "42", health_score: 100, recent_verdicts: [] });
  });
  it("extracts changed paths and penalizes blocked verdicts", () => {
    expect(filesFromDiff("+++ b/src/app.ts\n+++ b/src/app.ts\n+++ b/README.md")).toEqual(["src/app.ts", "README.md"]);
    expect(deriveHealthScore([{ commit_sha: "a", risk_level: "dangerous", verdict: "block", timestamp: "now" }])).toBe(80);
  });
});
