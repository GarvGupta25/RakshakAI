# AgentGuard

AgentGuard is a persistent, diff-first GitHub App orchestrator for teams using coding agents. It ACKs webhooks quickly, queues analysis, remembers repository health, and only applies low-risk cleanup automatically.

## Phase 1 architecture

`GitHub webhook → BullMQ → per-repo Redis lock → disposable Docker sandbox → diff scan/classification → structured LLM verdict → GitHub checks/notifications`

The server runs without external credentials for local development. Configure `.env` from `.env.example` to enable Redis, GitHub App, model, and Discord integrations.

## Local development

```bash
npm install
npm run infra:up
npm run sandbox:build
npm run dev
```

Use `POST /webhooks/github` for signed GitHub webhooks and `GET /health` for health checks.

Build the isolated scanner image once with `docker build -t agentguard-sandbox sandbox`.

## GitHub App setup

Create a GitHub App with repository permissions for Contents (read/write), Checks (read/write), Pull requests (read/write), and Metadata (read-only). Subscribe it to `push`, `pull_request`, and `check_run` webhooks, then set its webhook URL to `/webhooks/github`. Put the generated App ID, private key, and webhook secret into `.env`; never commit them.

`ENABLE_BRANCH_ROLLBACK` is deliberately disabled by default. When enabled, AgentGuard only resets an unprotected branch to its stored last-known-safe SHA. Credential rotation remains provider-specific and must be configured with an OIDC role before production use.
