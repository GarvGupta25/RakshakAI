import { describe, expect, it } from "vitest";
import { incidentExplainUrl } from "../src/urls.js";

describe("incidentExplainUrl", () => {
  it("builds an absolute, encoded explanation link", () => {
    expect(incidentExplainUrl("https://guard.example/base", "repo/42", "sha value")).toBe("https://guard.example/explain?repo=repo%2F42&sha=sha+value");
  });
});
