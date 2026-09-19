import { config } from "./config.js";
import { getInstallationToken } from "./github.js";
import type { PushJob } from "./queue.js";

export type RemediationResult = { rollback: "skipped" | "completed"; reason: string };

/**
 * Rollback is intentionally opt-in. A production installation must explicitly
 * enable it; protected branches are never rewritten by AgentGuard.
 */
export async function remediateBlockedChange(job: PushJob, lastKnownSafeSha: string | null): Promise<RemediationResult> {
  if (!config.enableBranchRollback) return { rollback: "skipped", reason: "Rollback disabled by deployment policy" };
  if (!lastKnownSafeSha) return { rollback: "skipped", reason: "No known-safe commit exists" };
  if (!job.ref.startsWith("refs/heads/")) return { rollback: "skipped", reason: "Push is not a branch ref" };
  const branch = job.ref.slice("refs/heads/".length);
  const token = await getInstallationToken(job.installationId);
  const protection = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/branches/${encodeURIComponent(branch)}/protection`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } });
  if (protection.ok) return { rollback: "skipped", reason: "Protected branch cannot be rewritten" };
  if (protection.status !== 404) throw new Error(`Unable to inspect branch protection (${protection.status})`);
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sha: lastKnownSafeSha, force: true })
  });
  if (!response.ok) throw new Error(`Rollback failed (${response.status})`);
  return { rollback: "completed", reason: `Reset to known-safe ${lastKnownSafeSha.slice(0, 8)}` };
}
