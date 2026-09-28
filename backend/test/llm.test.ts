import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { callCheapModel, callReasoningModel } from "../src/llm.js";

afterEach(() => vi.unstubAllGlobals());

describe("LLM usage accounting", () => {
  it("reads token totals from both provider response formats", async () => {
    config.groqApiKey = "test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ risk_level: "safe", reason: "ok" }) } }], usage: { total_tokens: 17 } }), { status: 200 })));
    expect((await callCheapModel("diff", {})).tokens_used).toBe(17);

    config.geminiApiKey = "test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: "allow", human_summary: "ok", technical_summary: "ok" }) }] } }], usageMetadata: { totalTokenCount: 23 } }), { status: 200 })));
    expect((await callReasoningModel("diff", {})).tokens_used).toBe(23);
  });
});
