import { describe, expect, it } from "vitest";
import { analysisJobId } from "../src/queue.js";

describe("analysis queue", () => {
  it("deduplicates ordinary events but gives requested reruns a fresh id", () => {
    const job = { repoId: "42", sha: "abc123" };
    expect(analysisJobId(job)).toBe("42:abc123");
    expect(analysisJobId(job, 1000)).toBe("42:abc123:1000");
  });
});
