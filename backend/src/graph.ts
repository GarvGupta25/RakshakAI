import { posix } from "node:path";
import type { Redis } from "ioredis";
import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";

export interface GraphNode { id: string; type: "file" | "function" | "class"; content: string; parent?: string; dirty?: boolean }
export interface GraphEdge { from: string; to: string; type: "imports" | "calls" }
export interface GraphSnapshot { nodes: GraphNode[]; edges: GraphEdge[] }
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

const mermaidId = (id: string) => `n${Buffer.from(id).toString("hex").slice(0, 24)}`;
export function renderMermaid(graph: GraphSnapshot) {
  if (!graph.nodes.length) return "graph LR\n  Empty[No dependency context]";
  const labels = graph.nodes.map(node => `  ${mermaidId(node.id)}["${node.id.replace(/["<>]/g, "")}"]`);
  const known = new Set(graph.nodes.map(node => node.id));
  const edges = graph.edges.filter(edge => known.has(edge.from) && known.has(edge.to)).map(edge => `  ${mermaidId(edge.from)} -->|${edge.type}| ${mermaidId(edge.to)}`);
  return ["graph LR", ...labels, ...edges].join("\n");
}

export class DependencyGraph {
  constructor(private readonly redis: Redis, private readonly repoId: string) {}
  private key(type: "nodes" | "edges" | "reverse" | "dirty" | "last-dirty" | "member-files") { return `agentguard:repo:${this.repoId}:graph:${type}`; }
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
  async snapshot(): Promise<GraphSnapshot> {
    const [nodeValues, edgeValues, dirtyIds] = await Promise.all([this.redis.hvals(this.key("nodes")), this.redis.hvals(this.key("edges")), this.redis.smembers(this.key("last-dirty"))]);
    const dirty = new Set(dirtyIds);
    return { nodes: nodeValues.map(value => { const node = JSON.parse(value) as GraphNode; return dirty.has(node.id) ? { ...node, dirty: true } : node; }), edges: edgeValues.flatMap(value => JSON.parse(value)) };
  }
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
  async getDirtySubgraph(): Promise<GraphSnapshot> {
    const nodes = await this.getDirtyNodes();
    const edges = (await Promise.all(nodes.map(node => this.getEdges(node.id)))).flat();
    await this.redis.del(this.key("last-dirty"));
    if (nodes.length) await this.redis.sadd(this.key("last-dirty"), ...nodes.map(node => node.id));
    return { nodes, edges };
  }
  async clearDirty() { await this.redis.del(this.key("dirty")); }
  async updateFiles(changes: Record<string, string | null>) {
    const current = await this.snapshot();
    current.nodes = current.nodes.map(({ dirty: _dirty, ...node }) => node);
    const sources = Object.fromEntries(current.nodes.filter(node => node.type === "file").map(node => [node.id, node.content]));
    for (const [path, content] of Object.entries(changes)) content === null ? delete sources[path] : sources[path] = content;
    // ponytail: reparse persisted sources in memory; switch to Tree-sitter edit ranges when repositories exceed practical Redis-backed size.
    const next = parseDependencyGraph(sources);
    const oldNodes = new Map(current.nodes.map(node => [node.id, node]));
    const newNodes = new Map(next.nodes.map(node => [node.id, node]));
    const removedNodes = [...oldNodes.keys()].filter(id => !newNodes.has(id));
    if (removedNodes.length) await this.redis.hdel(this.key("nodes"), ...removedNodes);
    for (const [id, node] of newNodes) if (JSON.stringify(oldNodes.get(id)) !== JSON.stringify(node)) await this.setNode(node);

    const edgeId = (edge: GraphEdge) => `${edge.from}\0${edge.to}\0${edge.type}`;
    const oldEdgeIds = new Set(current.edges.map(edgeId));
    const newEdgeIds = new Set(next.edges.map(edgeId));
    const changedEdges = [...current.edges.filter(edge => !newEdgeIds.has(edgeId(edge))), ...next.edges.filter(edge => !oldEdgeIds.has(edgeId(edge)))];
    const affectedFrom = new Set(changedEdges.map(edge => edge.from));
    const affectedTo = new Set(changedEdges.map(edge => edge.to));
    for (const from of affectedFrom) {
      const edges = next.edges.filter(edge => edge.from === from);
      edges.length ? await this.redis.hset(this.key("edges"), from, JSON.stringify(edges)) : await this.redis.hdel(this.key("edges"), from);
    }
    for (const to of affectedTo) {
      const edges = next.edges.filter(edge => edge.to === to);
      edges.length ? await this.redis.hset(this.key("reverse"), to, JSON.stringify(edges)) : await this.redis.hdel(this.key("reverse"), to);
    }
    for (const path of Object.keys(changes)) {
      await this.redis.del(this.membersKey(path));
      const members = next.nodes.filter(node => node.parent === path).map(node => node.id);
      if (members.length) { await this.redis.sadd(this.membersKey(path), ...members); await this.redis.sadd(this.key("member-files"), path); }
      else await this.redis.srem(this.key("member-files"), path);
    }
    return { filesChanged: Object.keys(changes).length, nodesChanged: removedNodes.length + [...newNodes].filter(([id, node]) => JSON.stringify(oldNodes.get(id)) !== JSON.stringify(node)).length, edgesChanged: changedEdges.length };
  }
  async buildFullGraph(sources: Record<string, string>) {
    const graph = parseDependencyGraph(Object.fromEntries(Object.entries(sources).filter(([path]) => sourceExtension.test(path))));
    const oldMemberFiles = await this.redis.smembers(this.key("member-files"));
    await this.redis.del(this.key("nodes"), this.key("edges"), this.key("reverse"), this.key("dirty"), this.key("last-dirty"), this.key("member-files"), ...oldMemberFiles.map(file => this.membersKey(file)));
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
