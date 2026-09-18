import { describe, expect, it } from "vitest";
import { emptyRepoState } from "../src/state.js";

describe("RepoState", () => {
  it("starts with an explicit healthy, empty repository memory", () => {
    expect(emptyRepoState("42")).toMatchObject({ repo_id: "42", health_score: 100, recent_verdicts: [] });
  });
});
