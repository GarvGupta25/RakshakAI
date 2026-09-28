export function incidentExplainUrl(baseUrl: string, repoId: string, sha: string) {
  const url = new URL("/explain", baseUrl);
  url.searchParams.set("repo", repoId);
  url.searchParams.set("sha", sha);
  return url.toString();
}
