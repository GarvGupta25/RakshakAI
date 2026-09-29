# AgentGuard

AgentGuard is a persistent, diff-first GitHub App orchestrator for teams using coding agents. It ACKs webhooks quickly, queues analysis, remembers repository health, and only applies low-risk cleanup automatically.

## Phase 1 architecture

`GitHub webhook → BullMQ → per-repo Redis lock → disposable Docker sandbox → diff scan/classification → structured LLM verdict → GitHub checks/notifications`

## Phase 2 graph

On installation, AgentGuard parses JavaScript and TypeScript with Tree-sitter into PostgreSQL-backed file, function, class, import, and call relationships. Pushes fetch changed sources only, persist graph deltas, propagate dirtiness one hop to callers/importers, and send a bounded dirty subgraph to the model. `GET /api/repositories/:id/graph` returns source-free visualization data; `POST /api/repositories/:id/graph/rebuild` performs a recovery rebuild from GitHub.

Configure `.env` from `.env.example` to enable Redis, PostgreSQL, GitHub App, model, and Discord integrations.

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

Create a GitHub App with repository permissions for Contents (read/write), Checks (read/write), Pull requests (read/write), and Metadata (read-only). Subscribe it to `push`, `pull_request`, `check_run`, `installation`, and `installation_repositories`; set its webhook URL to `/webhooks/github` and setup URL to `/setup`. Put the generated App ID, app slug, private key, and webhook secret into `.env`; never commit them. The dashboard's install button opens `/install`, which redirects to GitHub's repository-selection flow.

Set `PUBLIC_URL` to the externally reachable backend origin so Discord alerts and GitHub comments link to the rendered explanation page. Set `DASHBOARD_URL` to the deployed dashboard origin for the post-install redirect.

## Current scope decisions

- The dashboard reports total token usage only; provider-tier token breakdowns are intentionally out of scope.
- Incident resolution and notification delivery history are part of Phase 1.
- Dashboard API authentication and authorization are deferred until the core local end-to-end flow is complete.

`ENABLE_BRANCH_ROLLBACK` is deliberately disabled by default. When enabled, AgentGuard only resets an unprotected branch to its stored last-known-safe SHA. Credential rotation remains provider-specific and must be configured with an OIDC role before production use.
