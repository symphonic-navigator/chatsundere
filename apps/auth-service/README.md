# @chatsundere/auth-service

Hono on Bun. The account-linking and authentication backend for Chatsundere's local-first identity model. Stores ciphertext blobs and verifies cryptographic proofs; never sees passphrases, master keys, or recovery keys.

See `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` for the full design. This README covers operational concerns.

## Running locally

```bash
# Bring up Postgres + Redis from infra/
docker compose -f infra/compose.dev.yml up -d

# Generate fresh JWT and invitation HMAC secrets (write into apps/auth-service/.env)
bun -e "console.log('AUTH_JWT_PRIVATE_KEY=' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
bun -e "console.log('INVITATION_HMAC_KEY=' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"

# Run migrations
pnpm --filter @chatsundere/auth-service db:migrate

# Bootstrap the primary admin (writes a 0600 file with the QR payload)
pnpm --filter @chatsundere/auth-service bootstrap-admin

# Start the service
pnpm --filter @chatsundere/auth-service dev
```

## Endpoints

See `superpowers/specs/2026-05-18-foundational-auth-layer-design.md` §5.1 for the full catalogue. Key paths:

- `GET /healthz`, `/readyz`, `/metrics`, `/v1/jwks`
- `POST /v1/link/{opaque,passkey}/{start,finish}` — invitation-token-authorised linking flows
- `POST /v1/{opaque,passkey}/login/{start,finish}` — login flows
- `POST /v1/recovery/{start,finish}` — challenge-response recovery
- `POST /v1/token/refresh`, `POST /v1/auth/logout` — token management
- `GET|PATCH|DELETE /v1/me`, `DELETE /v1/auth-methods/:id`, `POST /v1/auth-methods/passphrase/change/{start,finish}` — self-service
- `GET|POST|DELETE /v1/admin/{users,invitations}`, `POST /v1/admin/users/:id/{suspend,unsuspend,role}`, `POST /v1/admin/transfer-primary`, `GET /v1/admin/audit-log` — admin

## Configuration

All configuration via env vars; see `.env.example` for the full set with descriptions. Required for any non-dev startup: `API_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `AUTH_JWT_PRIVATE_KEY`, `INVITATION_HMAC_KEY`, `CORS_ALLOWED_ORIGINS`.

## Testing

```bash
pnpm --filter @chatsundere/auth-service test
RUN_INTEGRATION=1 pnpm --filter @chatsundere/auth-service test:integration
```

Integration tests require live Postgres and Redis on the default URLs (the compose file from `infra/` is sufficient).

## Licence

AGPL-3.0-only.
