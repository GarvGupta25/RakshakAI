import { createServer } from "node:http";
import { Probot, ProbotOctokit } from "probot";
import { config } from "./config.js";
import { enqueuePush } from "./queue.js";

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
createServer((request, response) => middleware(request, response, () => {
  response.writeHead(404); response.end();
})).listen(config.port, () => console.log(`AgentGuard listening on ${config.port}`));
