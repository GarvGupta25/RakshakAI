import { describe, expect, it } from "vitest";
import { parseDependencyGraph, renderMermaid } from "../src/graph.js";

describe("dependency graph parsing", () => {
  it("resolves local imports and ignores package dependencies", () => {
    const graph = parseDependencyGraph({ "src/index.ts": 'import { guard } from "./guard"; import "express"; export function run() { return guard(); }', "src/guard.ts": 'export const guard = () => "safe";', "src/unused.ts": "export class Unused {}" });
    expect(graph.nodes.map(node => [node.id, node.type])).toEqual(expect.arrayContaining([["src/index.ts#function:run", "function"], ["src/guard.ts#function:guard", "function"], ["src/unused.ts#class:Unused", "class"]]));
    expect(graph.edges).toEqual(expect.arrayContaining([{ from: "src/index.ts", to: "src/guard.ts", type: "imports" }, { from: "src/index.ts#function:run", to: "src/guard.ts#function:guard", type: "calls" }]));
  });
  it("renders the current subgraph for GitHub comments", () => {
    const diagram = renderMermaid({ nodes: [{ id: "src/index.ts", type: "file", content: "" }, { id: "src/guard.ts", type: "file", content: "" }], edges: [{ from: "src/index.ts", to: "src/guard.ts", type: "imports" }] });
    expect(diagram).toContain("-->|imports|");
    expect(diagram).toContain("src/guard.ts");
  });
});
