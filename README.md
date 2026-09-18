# AgentGuard

AgentGuard is a persistent, diff-first GitHub App orchestrator for teams using coding agents. It ACKs webhooks quickly, queues analysis, remembers repository health, and only applies low-risk cleanup automatically.

## Phase 1 architecture

`GitHub webhook → BullMQ → per-repo Redis lock → disposable Docker sandbox → diff scan/classification → structured LLM verdict → GitHub checks/notifications`

The server runs without external credentials for local development. Configure `.env` from `.env.example` to enable Redis, GitHub App, model, and Discord integrations.

## Local development

```bash
npm install
npm run sandbox:build
npm run dev
```

Use `POST /webhooks/github` for signed GitHub webhooks and `GET /health` for health checks.

Build the isolated scanner image once with `docker build -t agentguard-sandbox sandbox`.
