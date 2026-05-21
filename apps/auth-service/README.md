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

Unit tests:

```bash
pnpm --filter @chatsundere/auth-service test
```

### Running integration tests

The full-lifecycle integration test truncates every table in `beforeAll`.
To prevent this from destroying dev or production data, it requires a
**separate** Postgres database via the `TEST_DATABASE_URL` env var.

The dev compose creates `auth_db_test` automatically on first boot
(see `infra/postgres/init/02-create-test-db.sql`). Apply the schema once:

```bash
DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  pnpm --filter @chatsundere/auth-service db:migrate
```

Then run integration tests:

```bash
TEST_DATABASE_URL=postgres://chatsundere:dev@localhost:5432/auth_db_test \
  REDIS_URL=redis://localhost:6379/0 \
  pnpm --filter @chatsundere/auth-service test:integration
```

The test suite will refuse to run if `TEST_DATABASE_URL` is unset, and will
**throw** if `TEST_DATABASE_URL` equals `DATABASE_URL`.

## Licence

AGPL-3.0-only.
