import type { Redis } from "ioredis";

export type RiskLevel = "safe" | "needs_review" | "dangerous";
export type Verdict = "allow" | "allow_with_flag" | "block";

export interface RepoState {
  repo_id: string;
  last_scanned_commit_sha: string | null;
  known_file_list: string[];
  recent_verdicts: Array<{ commit_sha: string; risk_level: RiskLevel; verdict: Verdict; timestamp: string }>;
  health_score: number;
  tokens_spent_today: number;
  auto_corrections_applied: number;
}

const stateKey = (repoId: string) => `agentguard:repo:${repoId}:state`;

export function emptyRepoState(repoId: string): RepoState {
  return { repo_id: repoId, last_scanned_commit_sha: null, known_file_list: [], recent_verdicts: [], health_score: 100, tokens_spent_today: 0, auto_corrections_applied: 0 };
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

  async getRelevantContext(repoId: string, _diff: string) {
    const state = await this.getRepoState(repoId);
    return { known_file_list: state.known_file_list, recent_verdicts: state.recent_verdicts.slice(-5) };
  }
}
