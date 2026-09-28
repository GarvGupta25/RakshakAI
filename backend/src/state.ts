import type { Redis } from "ioredis";
import { DependencyGraph } from "./graph.js";

export type RiskLevel = "safe" | "needs_review" | "dangerous";
export type Verdict = "allow" | "allow_with_flag" | "block";
export type AnalysisTier = "static" | "cheap" | "reasoning";
export type VerdictRecord = { commit_sha: string; risk_level: RiskLevel; verdict: Verdict; timestamp: string; tier?: AnalysisTier; latency_ms?: number; files?: string[]; summary?: string; cheap_verdict?: unknown; final_verdict?: unknown };

export interface RepoState {
  repo_id: string;
  last_scanned_commit_sha: string | null;
  known_file_list: string[];
  recent_verdicts: VerdictRecord[];
  health_score: number;
  tokens_spent_today: number;
  tokens_spent_on: string;
  auto_corrections_applied: number;
}

const stateKey = (repoId: string) => `agentguard:repo:${repoId}:state`;

export function emptyRepoState(repoId: string): RepoState {
  return { repo_id: repoId, last_scanned_commit_sha: null, known_file_list: [], recent_verdicts: [], health_score: 100, tokens_spent_today: 0, tokens_spent_on: new Date().toISOString().slice(0, 10), auto_corrections_applied: 0 };
}

export class RepoStateStore {
  constructor(private readonly redis: Redis) {}

  async getRepoState(repoId: string): Promise<RepoState> {
    const raw = await this.redis.get(stateKey(repoId));
    return raw ? { ...emptyRepoState(repoId), ...JSON.parse(raw) } : emptyRepoState(repoId);
  }

  async updateRepoState(repoId: string, patch: Partial<RepoState>): Promise<RepoState> {
    const next = { ...await this.getRepoState(repoId), ...patch, repo_id: repoId };
    await this.redis.set(stateKey(repoId), JSON.stringify(next));
    return next;
  }

  async getRelevantContext(repoId: string, diff: string) {
    const state = await this.getRepoState(repoId);
    const graph = new DependencyGraph(this.redis, repoId);
    
    // Mark files from diff as dirty in the graph
    const changedFiles = filesFromDiff(diff);
    for (const file of changedFiles) {
      await graph.markDirty(file);
    }
    
    const dirtySubgraph = await graph.getDirtySubgraph();
    await graph.clearDirty();
    
    // Fallback to Phase 1 context if the graph is empty (e.g. initial setup not done)
    if (dirtySubgraph.nodes.length === 0) {
      return { known_file_list: state.known_file_list, recent_verdicts: state.recent_verdicts.slice(-5) };
    }
    
    return { 
      dirty_subgraph: dirtySubgraph,
      recent_verdicts: state.recent_verdicts.slice(-5) 
    };
  }
}

export function deriveHealthScore(verdicts: RepoState["recent_verdicts"]): number {
  const weights = { allow: 0, allow_with_flag: 4, block: 20 } as const;
  return Math.max(0, 100 - verdicts.slice(-20).reduce((total, item) => total + weights[item.verdict], 0));
}

export const appendVerdict = (verdicts: VerdictRecord[], verdict: VerdictRecord) => [...verdicts, verdict].slice(-50);

export function addTokenUsage(state: Pick<RepoState, "tokens_spent_today" | "tokens_spent_on">, tokens: number, today = new Date().toISOString().slice(0, 10)) {
  return { tokens_spent_today: (state.tokens_spent_on === today ? state.tokens_spent_today : 0) + tokens, tokens_spent_on: today };
}

export function filesFromDiff(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^(?:\+\+\+ b\/|--- a\/)(.+)$/gm)].map(match => match[1]).filter(file => file !== "/dev/null"))];
}
