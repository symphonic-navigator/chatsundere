# @chatsundere/admin-client

Admin UI for Chatsundere. Phase 0 is a single `<h1>`. User management,
invitation creation, suspensions, primary-admin transfer arrive in the
admin-client wiring unit.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/admin-client dev
```

Opens on `http://localhost:3010`.

## Licence

AGPL-3.0-only — see `LICENSE`.
