# @chatsundere/auth-service

Authentication service for Chatsundere. Phase 0 is a skeleton exposing only
`/healthz`, `/readyz`, and `/metrics` on port 3100. Real OPAQUE registration,
WebAuthn passkey support, JWT issuance, recovery, and admin endpoints arrive
in the auth-service implementation unit.

## Run

```bash
cp .env.example .env  # or use scripts/setup-dev.sh from the repository root
pnpm --filter @chatsundere/auth-service dev
```

## Endpoints (Phase 0)

- `GET /healthz` — liveness, always 200.
- `GET /readyz` — readiness; placeholder until real probes land.
- `GET /metrics` — Prometheus exposition (default Node metrics with `auth_` prefix).

## Licence

AGPL-3.0-only — see `LICENSE` and the repository root `LICENSE-AGPLv3`.
