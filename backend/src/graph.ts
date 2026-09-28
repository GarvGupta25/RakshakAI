import { posix } from "node:path";
import type { Redis } from "ioredis";
import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";

export interface GraphNode { id: string; type: "file" | "function" | "class"; content: string; parent?: string }
export interface GraphEdge { from: string; to: string; type: "imports" | "calls" }
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/;
const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)/g;
const parser = new Parser();
parser.setLanguage(ts.typescript);

function symbolNodes(path: string, content: string) {
  const nodes: GraphNode[] = [];
  const calls = new Map<string, string[]>();
  const visit = (node: Parser.SyntaxNode) => {
    const variableValue = node.type === "variable_declarator" ? node.childForFieldName("value") : null;
    const type = node.type === "class_declaration" ? "class" : node.type === "function_declaration" || node.type === "method_definition" || (variableValue && ["arrow_function", "function"].includes(variableValue.type)) ? "function" : null;
    if (type) {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        const id = `${path}#${type}:${name}`;
        nodes.push({ id, type, content: node.text, parent: path });
        const called: string[] = [];
        const findCalls = (child: Parser.SyntaxNode) => {
          if (child.type === "call_expression") {
            const target = child.childForFieldName("function")?.text;
            if (target && /^[A-Za-z_$][\w$]*$/.test(target)) called.push(target);
          }
          child.namedChildren.forEach(findCalls);
        };
        node.namedChildren.forEach(findCalls);
        calls.set(id, called);
      }
    }
    node.namedChildren.forEach(visit);
  };
  visit(parser.parse(content).rootNode);
  return { nodes, calls };
}

function resolveImport(from: string, target: string, files: Set<string>) {
  if (!target.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), target));
  return [base, ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"].map(suffix => `${base}${suffix}`)].find(candidate => files.has(candidate)) ?? null;
}

export function parseDependencyGraph(sources: Record<string, string>) {
  const paths = new Set(Object.keys(sources));
  const nodes: GraphNode[] = Object.entries(sources).map(([id, content]) => ({ id, type: "file", content }));
  const edges: GraphEdge[] = [];
  const calls = new Map<string, string[]>();
  for (const [path, content] of Object.entries(sources)) {
    const symbols = symbolNodes(path, content);
    nodes.push(...symbols.nodes);
    symbols.calls.forEach((value, key) => calls.set(key, value));
  }
  for (const [from, content] of Object.entries(sources)) for (const match of content.matchAll(importPattern)) {
    const to = resolveImport(from, match[1] ?? match[2], paths);
    if (to && !edges.some(edge => edge.from === from && edge.to === to)) edges.push({ from, to, type: "imports" });
  }
  const symbolsByName = new Map<string, string[]>();
  for (const node of nodes.filter(node => node.type !== "file")) {
    const name = node.id.slice(node.id.lastIndexOf(":") + 1);
    symbolsByName.set(name, [...symbolsByName.get(name) ?? [], node.id]);
  }
  for (const [from, names] of calls) for (const name of names) {
    const targets = symbolsByName.get(name);
    if (targets?.length === 1 && targets[0] !== from && !edges.some(edge => edge.from === from && edge.to === targets[0])) edges.push({ from, to: targets[0], type: "calls" });
  }
  return { nodes, edges };
}

export class DependencyGraph {
  constructor(private readonly redis: Redis, private readonly repoId: string) {}
  private key(type: "nodes" | "edges" | "reverse" | "dirty" | "member-files") { return `agentguard:repo:${this.repoId}:graph:${type}`; }
  private membersKey(file: string) { return `agentguard:repo:${this.repoId}:graph:members:${file}`; }
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
    const members = await this.redis.smembers(this.membersKey(nodeId));
    const memberDependents = await Promise.all(members.map(id => this.redis.hget(this.key("reverse"), id)));
    const symbolDependents = memberDependents.flatMap(value => value ? (JSON.parse(value) as GraphEdge[]).map(edge => edge.from) : []);
    await this.redis.sadd(this.key("dirty"), nodeId, ...members, ...dependents.map(edge => edge.from), ...symbolDependents);
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
    const oldMemberFiles = await this.redis.smembers(this.key("member-files"));
    await this.redis.del(this.key("nodes"), this.key("edges"), this.key("reverse"), this.key("dirty"), this.key("member-files"), ...oldMemberFiles.map(file => this.membersKey(file)));
    for (const node of graph.nodes) {
      await this.setNode(node);
      if (node.parent) {
        await this.redis.sadd(this.membersKey(node.parent), node.id);
        await this.redis.sadd(this.key("member-files"), node.parent);
      }
    }
    for (const edge of graph.edges) await this.addEdge(edge);
    return { files: graph.nodes.length, edges: graph.edges.length };
  }
}
