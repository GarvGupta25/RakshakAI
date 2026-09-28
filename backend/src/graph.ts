import { posix } from "node:path";
import type { Redis } from "ioredis";

export interface GraphNode { id: string; type: "file" | "function" | "class"; content: string }
export interface GraphEdge { from: string; to: string; type: "imports" | "calls" }
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)/g;

function resolveImport(from: string, target: string, files: Set<string>) {
  if (!target.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), target));
  return [base, ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"].map(suffix => `${base}${suffix}`)].find(candidate => files.has(candidate)) ?? null;
}

export function parseDependencyGraph(sources: Record<string, string>) {
  const paths = new Set(Object.keys(sources));
  const nodes: GraphNode[] = Object.entries(sources).map(([id, content]) => ({ id, type: "file", content }));
  const edges: GraphEdge[] = [];
  for (const [from, content] of Object.entries(sources)) for (const match of content.matchAll(importPattern)) {
    const to = resolveImport(from, match[1] ?? match[2], paths);
    if (to && !edges.some(edge => edge.from === from && edge.to === to)) edges.push({ from, to, type: "imports" });
  }
  return { nodes, edges };
}

export class DependencyGraph {
  constructor(private readonly redis: Redis, private readonly repoId: string) {}
  private key(type: "nodes" | "edges" | "reverse" | "dirty") { return `agentguard:repo:${this.repoId}:graph:${type}`; }
  async setNode(node: GraphNode) { await this.redis.hset(this.key("nodes"), node.id, JSON.stringify(node)); }
  async getNode(id: string): Promise<GraphNode | null> { const raw = await this.redis.hget(this.key("nodes"), id); return raw ? JSON.parse(raw) : null; }
  async addEdge(edge: GraphEdge) { await this.addIndexedEdge("edges", edge.from, edge); await this.addIndexedEdge("reverse", edge.to, edge); }
  private async addIndexedEdge(index: "edges" | "reverse", id: string, edge: GraphEdge) {
    const raw = await this.redis.hget(this.key(index), id);
    const edges: GraphEdge[] = raw ? JSON.parse(raw) : [];
    if (!edges.some(item => item.from === edge.from && item.to === edge.to && item.type === edge.type)) await this.redis.hset(this.key(index), id, JSON.stringify([...edges, edge]));
  }
  async getEdges(from: string): Promise<GraphEdge[]> { const raw = await this.redis.hget(this.key("edges"), from); return raw ? JSON.parse(raw) : []; }
  async markDirty(nodeId: string) {
    const raw = await this.redis.hget(this.key("reverse"), nodeId);
    const dependents: GraphEdge[] = raw ? JSON.parse(raw) : [];
    await this.redis.sadd(this.key("dirty"), nodeId, ...dependents.map(edge => edge.from));
  }
  async getDirtyNodes(): Promise<GraphNode[]> {
    const ids = await this.redis.smembers(this.key("dirty"));
    if (!ids.length) return [];
    const nodes = await this.redis.hmget(this.key("nodes"), ...ids);
    return nodes.filter((node): node is string => node !== null).map(node => JSON.parse(node));
  }
  async clearDirty() { await this.redis.del(this.key("dirty")); }
  async buildFullGraph(sources: Record<string, string>) {
    const graph = parseDependencyGraph(Object.fromEntries(Object.entries(sources).filter(([path]) => sourceExtension.test(path))));
    await this.redis.del(this.key("nodes"), this.key("edges"), this.key("reverse"), this.key("dirty"));
    for (const node of graph.nodes) await this.setNode(node);
    for (const edge of graph.edges) await this.addEdge(edge);
    return { files: graph.nodes.length, edges: graph.edges.length };
  }
}
