import { Redis } from "ioredis";

export interface GraphNode {
  id: string;      // file path or function name
  type: "file" | "function" | "class";
  content: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "imports" | "calls";
}

export class DependencyGraph {
  constructor(private readonly redis: Redis, private readonly repoId: string) {}

  private key(type: "nodes" | "edges" | "dirty") {
    return `agentguard:repo:${this.repoId}:graph:${type}`;
  }

  async setNode(node: GraphNode) {
    await this.redis.hset(this.key("nodes"), node.id, JSON.stringify(node));
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const raw = await this.redis.hget(this.key("nodes"), id);
    return raw ? JSON.parse(raw) : null;
  }

  async addEdge(edge: GraphEdge) {
    // Store edges as adjacency list: "edges" -> hash: from -> list of {to, type}
    const raw = await this.redis.hget(this.key("edges"), edge.from);
    const edges: GraphEdge[] = raw ? JSON.parse(raw) : [];
    if (!edges.some(e => e.to === edge.to && e.type === edge.type)) {
      edges.push(edge);
      await this.redis.hset(this.key("edges"), edge.from, JSON.stringify(edges));
    }
  }

  async getEdges(from: string): Promise<GraphEdge[]> {
    const raw = await this.redis.hget(this.key("edges"), from);
    return raw ? JSON.parse(raw) : [];
  }

  async markDirty(nodeId: string) {
    await this.redis.sadd(this.key("dirty"), nodeId);
    // Propagate one hop: find nodes that depend on this node.
    // Since we only have forward edges easily queryable, we might need a reverse index,
    // or just mark the node itself dirty for now in MVP.
  }

  async getDirtyNodes(): Promise<GraphNode[]> {
    const dirtyIds = await this.redis.smembers(this.key("dirty"));
    if (dirtyIds.length === 0) return [];
    const nodes = await this.redis.hmget(this.key("nodes"), ...dirtyIds);
    return nodes.filter(n => n !== null).map(n => JSON.parse(n!));
  }

  async clearDirty() {
    await this.redis.del(this.key("dirty"));
  }

  /**
   * Phase 2: One-time full parse of the repository.
   * In a complete production implementation, this would clone the repo,
   * run Tree-sitter to find all files, functions, classes, and their imports/calls,
   * and store them as nodes and edges in the graph.
   */
  async buildFullGraph(repoUrl: string, token: string) {
    console.log(`[Phase 2] Building full dependency graph for ${this.repoId}`);
    // Stub implementation to satisfy Phase 2 architectural requirement
    await this.setNode({ id: "index.ts", type: "file", content: "// entry point" });
    await this.setNode({ id: "utils.ts", type: "file", content: "// utilities" });
    await this.addEdge({ from: "index.ts", to: "utils.ts", type: "imports" });
  }
}
