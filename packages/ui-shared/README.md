# @chatsundere/ui-shared

Shared client-side primitives used by `apps/user-client` and `apps/admin-client`.

Contents:

- `components/` — small UI building blocks reused in both clients (ConfirmTyped, InlineMarker, motion utilities). Pure JSX with no theme assumptions.
- `login/` — hooks and helpers that orchestrate OPAQUE and passkey login. Each client renders its own form on top.
- `state/` — Zustand stores for session and connectivity, shared across clients on the same origin.

Licence: LGPL-3.0-only. The crypto, login, and state code is library code per ADR 0002 and may be embedded in proprietary clients.
