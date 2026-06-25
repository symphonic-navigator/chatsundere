# MCP "Local network" routing — per-server, opt-in direct connection

- **Date:** 2026-06-25
- **Author:** Liz (with Chris)
- **Status:** Approved (brainstorm) — pending spec review
- **Scope:** `apps/user-client` only. No backend touch.

## Problem

MCP servers are reached through the global CORS proxy by default, which is the
right behaviour for the common case. A growing subset of users, however, run
their own MCP servers on their **local network** (LAN) and want the client to
talk to them **directly**, without the proxy hop. The transport for this already
exists — the missing piece is a deliberate, opt-in user control with a safe
default.

## Existing machinery (discovered, not built)

The dual-mode transport is already present:

- `apps/user-client/src/mcp/mcp-client.ts:37-46` — switches between `direct`
  (fetch straight to the server URL) and `proxy` (route via the CORS proxy with
  `x-cors-proxy-target` / `x-cors-proxy-api-key` headers) based on
  `endpoint.routing`.
- `apps/user-client/src/mcp/mcp-connectivity.ts` — `buildCandidates()` currently
  probes `[direct/bare, direct/+mcp, proxy/bare, proxy/+mcp]`, i.e. **direct is
  tried first** for every server, silently. The first successful probe sets the
  stored `routing` and `resolvedEndpoint`.
- `apps/user-client/src/boot/client-data-db.ts:87-107` — `McpServerRow` already
  carries `routing: 'direct' | 'proxy' | null` (the *test outcome*) and
  `resolvedEndpoint`.

So a LAN MCP with CORS would technically connect today. What is missing is a
user-facing, opt-in control and a safe default that does **not** silently probe
the local network.

## Design decisions

1. **Per-server.** The control lives on each MCP server, mirroring the existing
   per-server `routing` field. No global master switch.
2. **Toggle semantics — auto-detect, gated.**
   - **OFF (default):** proxy-only. The connection test probes only proxy
     candidates; the client never attempts a direct connection into the network.
   - **ON:** the existing auto-detect order is restored for that server —
     `[direct/bare, direct/+mcp, proxy/bare, proxy/+mcp]` (direct-first, proxy
     fallback).
3. **Wording.** Label **"Local network"**, helper text **"(must support CORS)"**.
   Mechanically this is a *direct-connection* switch (it also works for a public
   CORS MCP), but the wording targets the actual audience — people self-hosting
   an MCP on their LAN. The public-CORS case is a harmless superset.
4. **Re-test is manual.** Flipping the toggle marks the server **untested**
   (`routing = null`, `resolvedEndpoint = null`); it does not auto-probe. The
   user presses "Test connection" themselves. No surprise network access.

## Data model

Add one intent field to `McpServerRow`, kept separate from the test outcome:

- **`allowDirect: boolean`** (default `false`) — the user's *intent* ("this
  server may be reached directly").
- `routing: 'direct' | 'proxy' | null` stays the *outcome* of the test —
  unchanged in meaning.

This is the clean split: **intent** (the toggle) vs. **outcome** (what the test
actually selected and the transport then uses).

### Migration (Dexie version bump)

Bump the Dexie schema version. Migrate existing rows:

- `routing === 'direct'`  → `allowDirect = true`
- everything else (`'proxy'`, `null`) → `allowDirect = false`

This preserves connectivity for any server already resolved to direct.

## Behaviour change — the single logic edit

`apps/user-client/src/mcp/mcp-connectivity.ts → buildCandidates()` becomes a
function of `allowDirect`:

- `allowDirect === false` → `[proxy/bare, proxy/+mcp]` only.
- `allowDirect === true`  → `[direct/bare, direct/+mcp, proxy/bare, proxy/+mcp]`
  (current behaviour).

Note: when `allowDirect === false` **and** no CORS proxy is configured, the
candidate list is empty and the test fails cleanly — the server then shows the
existing **"✗ Needs proxy"** status. That is correct and honest: without a proxy
and without opting into direct, the server is unreachable.

No changes to `resolve-active.ts`, `build-mcp-context.ts`, `mcp-tools.ts`, or
`mcp-client.ts` — they consume only the resolved `routing` and continue to work
unchanged.

## UI

`apps/user-client/src/components/mcp/McpServerSheet.tsx`:

- New toggle near the URL field: label **"Local network"**, helper
  **"(must support CORS)"**, default off. Always visible ("disabled over
  hidden").
- Flipping it resets the server to untested (`routing`/`resolvedEndpoint` →
  `null`) so the stale "Connected (direct/proxy)" status cannot linger.
- After the user runs "Test connection", the existing status line continues to
  confirm the actual outcome: "● Connected (direct)" vs "● Connected (via
  proxy)".

`apps/user-client/src/components/mcp/McpServersSection.tsx`: no structural
change. The existing "✗ Needs proxy" branch now legitimately covers OFF servers
with no proxy configured.

## Security

- **Client-only change.** No `apps/auth-service`, `sync-service`,
  `proxy-service`, or `packages/crypto` touch, so Larissa's path-based gate does
  not formally trigger. The capability nonetheless has a security flavour (the
  browser reaches into the LAN; credentials may egress to a LAN origin).
- **Credential egress is unchanged in bound:** auth is sent only to the
  user-entered origin, exactly as today. The toggle does not widen that bound; it
  only governs *whether* a direct attempt is made at all.
- **Audit:** Laura (UX) reviews pre-squash because this adds a new user-reachable
  control/flow. Larissa optional at Chris's discretion given the security
  flavour, despite the path gate not triggering.

## Testing

- **`buildCandidates()` unit test:** `allowDirect=false` → no direct candidates;
  `allowDirect=true` → direct-first order.
- **Migration test:** a row with `routing='direct'` migrates to
  `allowDirect=true`; `routing='proxy'`/`null` → `allowDirect=false`.
- **Dexie verno sweep:** the version bump breaks the ~24 hard-coded
  `expect(db.verno).toBe(N)` assertions across the test suite — update them in
  the same task (known trap; no central constant exists).
- Run `pnpm typecheck --force` and Biome at the gate (Turbo may cache a
  test-only typecheck pass).

## Manual verification (Chris, on device)

1. Add an MCP server pointing at a LAN address with **Local network OFF** and no
   proxy configured → "Test connection" → server shows "✗ Needs proxy".
2. Flip **Local network ON** → server returns to untested → "Test connection"
   → "● Connected (direct)"; tools list populates.
3. Flip **Local network OFF** again → server returns to untested; a subsequent
   test routes via the proxy (or shows "Needs proxy" if none configured).
4. Existing proxied internet MCP server still connects via proxy after the
   update (migration left `allowDirect=false`).
5. An existing server previously resolved to direct still connects after the
   update (migration set `allowDirect=true`).

## Out of scope (YAGNI)

- No global master switch.
- No private-IP / LAN-range auto-detection — the toggle is the user's explicit
  declaration.
- No per-server proxy configuration (the CORS proxy stays global).
