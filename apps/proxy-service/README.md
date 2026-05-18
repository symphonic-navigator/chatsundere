# @chatsundere/proxy-service

Authenticated CORS proxy that forwards user requests to upstream LLM
providers. Phase 0 is a skeleton with `/healthz`, `/readyz`, `/metrics`
on port 3300. The real implementation arrives in Phase 2 alongside
`@chatsundere/llm-unified`.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/proxy-service dev
```

## Licence

AGPL-3.0-only — see `LICENSE`.
