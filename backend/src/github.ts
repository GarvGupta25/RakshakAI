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
