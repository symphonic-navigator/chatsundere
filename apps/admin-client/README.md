# Chatsundere — Admin Client

Catppuccin-themed operator console for a Chatsundere server.

## Prerequisites

- Node 22+
- pnpm 9+
- A running `apps/auth-service` reachable via `VITE_AUTH_URL`.
- A user-client account already created and linked to the same server (the admin's account is provisioned via user-client onboarding; admin-client reads the same IndexedDB).

## Development

```sh
pnpm install
pnpm --filter @chatsundere/admin-client dev
```

The dev server runs at `http://localhost:5174/admin/` (note the path; this matches the production deployment where admin-client is mounted at `/admin` on the same origin as user-client).

## Environment

See `.env.example`. Every admin call goes to the auth-service.

## Manual verification

The current Manual-QA checklist lives in `superpowers/specs/2026-05-20-admin-client-design.md` §9. Follow it after a final-squash.
