import { describe, expect, it } from "vitest";
import { correctionBranch } from "../src/corrections.js";

describe("safe correction branches", () => {
  it("pushes directly only when the target branch is unprotected", () => {
    expect(correctionBranch("refs/heads/main", "1234567890", false)).toBe("main");
    expect(correctionBranch("refs/heads/main", "1234567890", true)).toBe("agentguard/format-12345678");
  });
});
