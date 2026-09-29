import { createServer } from "node:http";
import { URL } from "node:url";
import { Probot, ProbotOctokit } from "probot";
import { config } from "./config.js";
import { enqueuePush } from "./queue.js";
import "./worker.js";
import { connection } from "./queue.js";
import { IncidentStore } from "./incidents.js";
import { getRecentCommitDiffs, getRepositorySources } from "./github.js";
import { callReasoningModel } from "./llm.js";
import { RepoStateStore, addTokenUsage } from "./state.js";
import { DependencyGraph, publicGraphSnapshot } from "./graph.js";

const app = new Probot({
  appId: config.githubAppId,
  privateKey: config.githubPrivateKey,
  secret: config.webhookSecret,
  Octokit: ProbotOctokit
});

app.on("push", async (context) => {
  const { repository, after, installation, ref } = context.payload;
  if (!installation || !repository.owner || after.match(/^0+$/)) return;
  await enqueuePush({
    repoId: String(repository.id), owner: repository.owner.login, repo: repository.name,
    sha: after, installationId: installation.id, ref
  });
});

app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
  const { repository, pull_request: pullRequest, installation } = context.payload;
  if (!installation) return;
  await enqueuePush({
    repoId: String(repository.id), owner: repository.owner.login, repo: repository.name,
    sha: pullRequest.head.sha, installationId: installation.id, ref: `refs/heads/${pullRequest.head.ref}`
  });
});

app.on("check_run.rerequested", async (context) => {
  const { repository, check_run: checkRun, installation } = context.payload;
  if (!installation) return;
  await enqueuePush({
    repoId: String(repository.id), owner: repository.owner.login, repo: repository.name,
    sha: checkRun.head_sha, installationId: installation.id,
    ref: `refs/heads/${checkRun.check_suite?.head_branch ?? repository.default_branch}`
  }, true);
});

app.on(["installation.created", "installation_repositories.added" as any], async (context) => {
  const repositories = "repositories" in context.payload ? context.payload.repositories : (context.payload as any).repositories_added || [];
  for (const repo of repositories) {
    const repoId = String(repo.id);
    await repoStates.updateRepoState(repoId, { known_file_list: [] });
    const owner = "owner" in repo ? repo.owner.login : context.payload.installation.account.login;
    const sources = await getRepositorySources({ owner, repo: repo.name, installationId: context.payload.installation.id, ref: repo.default_branch });
    const graph = await new DependencyGraph(connection, repoId).buildFullGraph(sources);
    await repoStates.updateRepoState(repoId, { known_file_list: Object.keys(sources) });
    context.log.info({ repoId, repoName: repo.name, graph }, "provisioned repository dependency graph");
  }
});

const middleware = await app.getNodeMiddleware({ path: "/webhooks/github" });
const incidents = new IncidentStore(connection);
const repoStates = new RepoStateStore(connection);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === "/install" && request.method === "GET") {
    if (!config.githubAppSlug) { response.writeHead(503, { "content-type": "text/plain" }); response.end("GITHUB_APP_SLUG is not configured"); return; }
    response.writeHead(302, { location: `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new` }); response.end(); return;
  }
  if (url.pathname === "/setup" && request.method === "GET") {
    response.writeHead(302, { location: config.dashboardUrl }); response.end(); return;
  }
  const incidentListMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/incidents$/);
  if (incidentListMatch && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(await incidents.list(incidentListMatch[1]))); return;
  }
  const incidentMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/incidents\/([^/]+)$/);
  if (incidentMatch && request.method === "GET") {
    const incident = await incidents.get(incidentMatch[1], incidentMatch[2]);
    response.writeHead(incident ? 200 : 404, { "content-type": "application/json" }); response.end(JSON.stringify(incident ?? { error: "Incident not found" })); return;
  }
  if (incidentMatch && request.method === "POST") {
    const incident = await incidents.resolve(incidentMatch[1], incidentMatch[2]);
    response.writeHead(incident ? 200 : 404, { "content-type": "application/json" }); response.end(JSON.stringify(incident ?? { error: "Incident not found" })); return;
  }
  const stateMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)$/);
  if (stateMatch && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(await repoStates.getRepoState(stateMatch[1]))); return;
  }
  const graphMatch = url.pathname.match(/^\/api\/repositories\/([^/]+)\/graph$/);
  if (graphMatch && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(publicGraphSnapshot(await new DependencyGraph(connection, graphMatch[1]).snapshot()))); return;
  }
  if (url.pathname === "/explain") {
    const repoId = url.searchParams.get("repo"); const sha = url.searchParams.get("sha");
    if (!repoId || !sha) { response.writeHead(400); response.end("repo and sha are required"); return; }
    const incident = await incidents.get(repoId, sha);
    if (!incident) { response.writeHead(404); response.end("Incident not found"); return; }
    try {
      const history = await getRecentCommitDiffs(incident.job);
      const explanation = await callReasoningModel(incident.diff, { recent_diffs: history, task: "Explain the last 10 changes leading to the flagged commit in plain developer language, under one minute." });
      await repoStates.updateRepoState(repoId, addTokenUsage(await repoStates.getRepoState(repoId), explanation.tokens_used));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>AgentGuard Explain</title><style>body{max-width:800px;margin:48px auto;background:#111;color:#eee;font:16px system-ui;line-height:1.6}pre{white-space:pre-wrap;background:#1c1c1f;padding:16px;border-radius:8px}details{margin-top:30px}</style><h1>Why AgentGuard flagged this change</h1><p>${escapeHtml(explanation.human_summary)}</p><h2>Technical details</h2><p>${escapeHtml(explanation.technical_summary)}</p><details><summary>View flagged diff</summary><pre>${escapeHtml(incident.diff)}</pre></details>`);
    } catch (error) { response.writeHead(502); response.end(`Unable to generate explanation: ${escapeHtml(String(error))}`); }
    return;
  }
  middleware(request, response, () => {
  response.writeHead(404); response.end();
  });
}).listen(config.port, () => console.log(`AgentGuard listening on ${config.port}`));
