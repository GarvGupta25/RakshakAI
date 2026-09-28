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
  it("replaces only graph data affected by changed sources", async () => {
    const hashes = new Map<string, Map<string, string>>(); const sets = new Map<string, Set<string>>();
    const redis = { hset: async (key: string, field: string, value: string) => { const hash = hashes.get(key) ?? new Map(); hash.set(field, value); hashes.set(key, hash); }, hget: async (key: string, field: string) => hashes.get(key)?.get(field) ?? null, hvals: async (key: string) => [...hashes.get(key)?.values() ?? []], hdel: async (key: string, ...fields: string[]) => fields.forEach(field => hashes.get(key)?.delete(field)), sadd: async (key: string, ...values: string[]) => { const set = sets.get(key) ?? new Set(); values.forEach(value => set.add(value)); sets.set(key, set); }, srem: async (key: string, ...values: string[]) => values.forEach(value => sets.get(key)?.delete(value)), smembers: async (key: string) => [...sets.get(key) ?? []], del: async (...keys: string[]) => keys.forEach(key => { hashes.delete(key); sets.delete(key); }), hmget: async (key: string, ...fields: string[]) => fields.map(field => hashes.get(key)?.get(field) ?? null) };
    const graph = new (await import("../src/graph.js")).DependencyGraph(redis as never, "repo");
    await graph.buildFullGraph({ "src/a.ts": "export const a = () => 1", "src/b.ts": 'import { a } from "./a"; export const b = () => a()' });
    const result = await graph.updateFiles({ "src/a.ts": "export const a = () => 2" });
    expect(result).toMatchObject({ filesChanged: 1, nodesChanged: 2, edgesChanged: 0 });
    expect((await graph.getNode("src/b.ts"))?.content).toContain("import");
    expect((await graph.getNode("src/a.ts#function:a"))?.content).toContain("2");
  });
});
