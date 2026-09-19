import { describe, expect, it } from "vitest";

describe("remediation policy", () => {
  it("requires explicit opt-in before a remote rollback can occur", () => {
    expect(process.env.ENABLE_BRANCH_ROLLBACK).not.toBe("true");
  });
});
