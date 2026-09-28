import { describe, expect, it } from "vitest";
import { parseDependencyGraph } from "../src/graph.js";

describe("dependency graph parsing", () => {
  it("resolves local imports and ignores package dependencies", () => {
    const graph = parseDependencyGraph({ "src/index.ts": 'import { guard } from "./guard"; import "express";', "src/guard.ts": 'export const guard = () => "safe";', "src/unused.ts": "export {};" });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual([{ from: "src/index.ts", to: "src/guard.ts", type: "imports" }]);
  });
});
