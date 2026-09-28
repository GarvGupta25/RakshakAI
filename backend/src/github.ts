import { createAppAuth } from "@octokit/auth-app";
import { config } from "./config.js";

export async function getInstallationToken(installationId: number): Promise<string> {
  if (!config.githubAppId || !config.githubPrivateKey) throw new Error("GitHub App credentials are required for diff retrieval");
  const auth = createAppAuth({ appId: config.githubAppId, privateKey: config.githubPrivateKey, installationId });
  const result = await auth({ type: "installation" });
  return result.token;
}

export async function getCommitDiff(job: { owner: string; repo: string; sha: string; installationId: number }): Promise<string> {
  const token = await getInstallationToken(job.installationId);
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/commits/${job.sha}`, {
    headers: { Accept: "application/vnd.github.v3.diff", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }
  });
  if (!response.ok) throw new Error(`GitHub diff retrieval failed (${response.status})`);
  return response.text();
}

export async function setCommitCheck(job: { owner: string; repo: string; sha: string; installationId: number }, conclusion: "success" | "failure", summary: string) {
  const token = await getInstallationToken(job.installationId);
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/check-runs`, {
    method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "AgentGuard", head_sha: job.sha, status: "completed", conclusion, output: { title: `AgentGuard ${conclusion}`, summary } })
  });
  if (!response.ok) throw new Error(`GitHub check creation failed (${response.status})`);
}

export async function getRecentCommitDiffs(job: { owner: string; repo: string; installationId: number }, limit = 10): Promise<string[]> {
  const token = await getInstallationToken(job.installationId);
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/commits?per_page=${limit}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GitHub commit history retrieval failed (${response.status})`);
  const commits = await response.json() as Array<{ sha: string }>;
  return Promise.all(commits.map(commit => getCommitDiff({ ...job, sha: commit.sha })));
}

export async function postCommitComment(job: { owner: string; repo: string; sha: string; installationId: number }, body: string) {
  const token = await getInstallationToken(job.installationId);
  const response = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/commits/${job.sha}/comments`, {
    method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
  if (!response.ok) throw new Error(`GitHub commit comment creation failed (${response.status})`);
}

export async function getRepositorySources(job: { owner: string; repo: string; installationId: number; ref?: string }): Promise<Record<string, string>> {
  const token = await getInstallationToken(job.installationId);
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const treeResponse = await fetch(`https://api.github.com/repos/${job.owner}/${job.repo}/git/trees/${encodeURIComponent(job.ref ?? "HEAD")}?recursive=1`, { headers });
  if (!treeResponse.ok) throw new Error(`GitHub repository tree retrieval failed (${treeResponse.status})`);
  const tree = await treeResponse.json() as { truncated?: boolean; tree: Array<{ path: string; type: string; url?: string; size?: number }> };
  if (tree.truncated) throw new Error("GitHub repository tree is too large for full graph initialization");
  const files = tree.tree.filter(item => item.type === "blob" && item.url && item.size !== undefined && item.size <= 250_000 && /\.(?:[cm]?[jt]sx?)$/.test(item.path));
  const entries = await Promise.all(files.map(async file => {
    const response = await fetch(file.url!, { headers });
    if (!response.ok) throw new Error(`GitHub blob retrieval failed (${response.status})`);
    const blob = await response.json() as { content: string; encoding: string };
    return [file.path, blob.encoding === "base64" ? Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8") : ""] as const;
  }));
  return Object.fromEntries(entries);
}
