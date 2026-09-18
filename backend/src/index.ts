import { createNodeMiddleware, Probot, ProbotOctokit } from "probot";
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
  if (!installation || after.match(/^0+$/)) return;
  await enqueuePush({
    repoId: String(repository.id), owner: repository.owner.login, repo: repository.name,
    sha: after, installationId: installation.id, ref
  });
});

app.on("installation.created", async (context) => {
  for (const repository of context.payload.repositories) {
    await enqueuePush({
      repoId: String(repository.id), owner: repository.owner.login, repo: repository.name,
      sha: repository.default_branch, installationId: context.payload.installation.id,
      ref: `refs/heads/${repository.default_branch}`
    });
  }
});

const server = createNodeMiddleware(app, { webhookPath: "/webhooks/github" });
server.listen(config.port, () => console.log(`AgentGuard listening on ${config.port}`));
