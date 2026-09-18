import { createServer } from "node:http";
import { URL } from "node:url";
import { Probot, ProbotOctokit } from "probot";
import { config } from "./config.js";
import { enqueuePush } from "./queue.js";
import "./worker.js";
import { connection } from "./queue.js";
import { IncidentStore } from "./incidents.js";
import { getRecentCommitDiffs } from "./github.js";
import { callReasoningModel } from "./llm.js";

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

app.on("installation.created", async (context) => {
  context.log.info({ installationId: context.payload.installation.id }, "installation received; repositories will be provisioned on first push");
});

const middleware = await app.getNodeMiddleware({ path: "/webhooks/github" });
const incidents = new IncidentStore(connection);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === "/explain") {
    const repoId = url.searchParams.get("repo"); const sha = url.searchParams.get("sha");
    if (!repoId || !sha) { response.writeHead(400); response.end("repo and sha are required"); return; }
    const incident = await incidents.get(repoId, sha);
    if (!incident) { response.writeHead(404); response.end("Incident not found"); return; }
    try {
      const history = await getRecentCommitDiffs(incident.job);
      const explanation = await callReasoningModel(incident.diff, { recent_diffs: history, task: "Explain the last 10 changes leading to the flagged commit in plain developer language, under one minute." });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>AgentGuard Explain</title><style>body{max-width:800px;margin:48px auto;background:#111;color:#eee;font:16px system-ui;line-height:1.6}pre{white-space:pre-wrap;background:#1c1c1f;padding:16px;border-radius:8px}details{margin-top:30px}</style><h1>Why AgentGuard flagged this change</h1><p>${escapeHtml(explanation.human_summary)}</p><h2>Technical details</h2><p>${escapeHtml(explanation.technical_summary)}</p><details><summary>View flagged diff</summary><pre>${escapeHtml(incident.diff)}</pre></details>`);
    } catch (error) { response.writeHead(502); response.end(`Unable to generate explanation: ${escapeHtml(String(error))}`); }
    return;
  }
  middleware(request, response, () => {
  response.writeHead(404); response.end();
  });
}).listen(config.port, () => console.log(`AgentGuard listening on ${config.port}`));
