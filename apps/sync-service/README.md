# @chatsundere/sync-service

Encrypted-vault sync backend. Phase 0 is a skeleton exposing only `/healthz`,
`/readyz`, and `/metrics` on port 3200. The real implementation (encrypted
blob storage, conflict-free updates) lands in Phase 1.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/sync-service dev
```

## Licence

AGPL-3.0-only — see `LICENSE`.
