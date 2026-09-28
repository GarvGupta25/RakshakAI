import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getInstallationToken } from "./github.js";
import type { PushJob } from "./queue.js";

const execFileAsync = promisify(execFile);
const branchName = (ref: string) => ref.replace(/^refs\/heads\//, "");

async function branchIsProtected(job: PushJob, token: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/branches/${encodeURIComponent(branchName(job.ref))}/protection`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Unable to read branch protection (${response.status})`);
  return true;
}

export const correctionBranch = (ref: string, sha: string, protectedBranch: boolean) => protectedBranch ? `agentguard/format-${sha.slice(0, 8)}` : branchName(ref);

async function openCorrectionPullRequest(job: PushJob, token: string, head: string) {
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/pulls`, { method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: "chore: apply AgentGuard formatting", head, base: branchName(job.ref), body: "AgentGuard found a style-only diff and prepared this safe formatting correction for review." }) });
  if (!response.ok) throw new Error(`Unable to open correction pull request (${response.status})`);
}

/** Formatting runs inside an ephemeral container and never force-pushes shared history. */
export async function applySafeCorrection(job: PushJob): Promise<{ applied: boolean; reason: string }> {
  if (!job.ref.startsWith("refs/heads/")) return { applied: false, reason: "Not a branch push" };
  const token = await getInstallationToken(job.installationId);
  const protectedBranch = await branchIsProtected(job, token);
  const targetBranch = correctionBranch(job.ref, job.sha, protectedBranch);
  const script = [
    "set -eu", "git config --global user.name AgentGuard", "git config --global user.email agentguard[bot]@users.noreply.github.com",
    'git clone --depth 1 --branch "$GIT_BRANCH" "https://x-access-token:${GITHUB_TOKEN}@github.com/${GIT_OWNER}/${GIT_REPO}.git" repo',
    "cd repo", "npx --yes prettier --write .", "git diff --quiet || (git add -A && git commit -m 'chore: apply AgentGuard formatting' && git push origin HEAD:$GIT_TARGET_BRANCH && echo AGENTGUARD_APPLIED)"
  ].join(" && ");
  try {
    const { stdout } = await execFileAsync("docker", ["run", "--rm", "-e", `GITHUB_TOKEN=${token}`, "-e", `GIT_OWNER=${job.owner}`, "-e", `GIT_REPO=${job.repo}`, "-e", `GIT_BRANCH=${branchName(job.ref)}`, "-e", `GIT_TARGET_BRANCH=${targetBranch}`, "agentguard-sandbox", script], { timeout: 300_000 });
    const applied = stdout.includes("AGENTGUARD_APPLIED");
    if (applied && protectedBranch) await openCorrectionPullRequest(job, token, targetBranch);
    return { applied, reason: applied ? protectedBranch ? "Formatting correction opened for review" : "Formatting correction committed" : "Formatting already satisfied" };
  } catch (error) { throw new Error(`Safe correction failed in sandbox: ${String(error)}`); }
}
