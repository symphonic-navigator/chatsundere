# MCP Client — Design Spec

**Date:** 2026-06-08
**Author:** Liz (with Chris)
**Status:** Approved — ready for implementation plan
**Scope:** Client-only (Block 2+ integration). New `apps/user-client` feature; no
backend, no gateway.

---

## 1. Context

Chatsundere is a zero-knowledge, local-first AI companion platform. We want to let
companions call tools exposed by external **Model Context Protocol (MCP)** servers.

The predecessor (chatsune) shipped a working MCP feature, but via a **separate Python
gateway** (`chatsune-mcp-gateway`) that aggregated stdio + HTTP servers behind one
endpoint, with the browser speaking JSON-RPC against that gateway (and admin/remote
gateways proxied through chatsune's backend). Chatsundere has **no backend and no
gateway** — the MCP client must run entirely in the browser.

The defining constraint is **CORS**: a browser cannot freely call arbitrary
cross-origin HTTPS endpoints, and public MCP servers almost never send permissive
CORS headers (they are built for server-side clients). We already solved the same
problem for web search by routing through the user's **CORS proxy** (their VPS), via
the `x-cors-proxy-target` / `x-cors-proxy-api-key` contract in
`packages/llm-unified/src/transport.ts`. MCP-over-HTTP reuses that rail.

This spec covers **HTTPS MCP servers only** (Streamable HTTP, with and without SSE
streaming), explicitly including **public** servers. No stdio. No gateway.

## 2. Goals

- Connect the browser to public/private HTTPS MCP servers and expose their **tools**
  to companions, executed inside the existing tool-loop.
- Reuse the existing `Integration` abstraction and the CORS-proxy rail.
- Avoid tool-name collisions across servers via stable per-server prefixes.
- Pass per-server credentials (Bearer by default, optional custom header).
- Keep the user in control: a per-server "on by default" with per-persona overrides,
  and a confirmation gate before tool calls (per-server opt-out).
- Surface connectivity reality honestly via an explicit, re-runnable connection test.

## 3. Non-goals (deferred — YAGNI)

- MCP **Resources** and **Prompts** (tools only in v1).
- **OAuth 2.1** auth flows (static Bearer / header keys only).
- **stdio** servers and gateway aggregation.
- Server-initiated **sampling / elicitation**.
- A per-chat cockpit toggle (persona-level resolution is the only gate; explicitly
  decided against extra cockpit chrome).

## 4. Decisions (from the brainstorm)

| # | Decision | Choice |
|---|---|---|
| D1 | How browser reaches servers | **Per-server connectivity test**: try direct first; if it fails and a proxy is configured, try via proxy; store the resolved routing and show it; user can re-run the test if the provider changes its CORS modalities. |
| D2 | Tool-name collisions | **Stable per-server prefix, always applied.** Default derived from the server name (sanitised), editable per server. Predictable, collision-safe, never changes under the model. |
| D3 | URL / `/mcp` suffix | **URL as entered**; the connection test additionally probes a `+/mcp` variant on failure and reports which worked. No silent appending. |
| D4 | Where tools become active | **Per-server `onByDefault` + per-persona tri-state override.** Persona override unset → server default applies; set → forces on/off. New `onByDefault:true` servers are immediately available everywhere without touching each persona. |
| D5 | Tool-call approval | **Confirm by default, per-server `autoRun` opt-out.** A trusted server runs without prompts; otherwise the call is shown (server · tool · args) and awaits Approve/Deny. |
| D6 | Capability scope | **Tools only.** |
| D7 | Auth | **Bearer by default + optional custom header name.** OAuth deferred. |
| D8 | Cockpit chip | **No** — persona-level resolution is sufficient. |
| D9 | Code location | **`apps/user-client`** (no `packages/mcp-client` — admin-client has no AI surface and needs none). |
| D10 | Larissa | **Yes — one round**, despite not being a §9-gated path, because of the new egress + credential handling + approval gate (trust positioning). |

## 5. Architecture

A new **MCP integration** in the user-client, following the `web-integration`
pattern: it implements the existing `Integration` interface
(`apps/user-client/src/integrations/types.ts`) and, via `contributesTools(ctx)`,
returns dynamically built `Tool[]` from the servers that resolve **active** for the
current persona. It is registered in `apps/user-client/src/integrations/index.ts`
alongside `webIntegration` and `artefactIntegration`.

The JSON-RPC mechanics are **ported from chatsune's `mcpClient.ts`** (it is solid):
`initialize` → `notifications/initialized` → `tools/list` / `tools/call`; both
`application/json` and `text/event-stream` responses; session lifecycle via the
`Mcp-Session-Id` header; HTTP 404 → clear session and re-initialise. MCP protocol
version `2025-06-18`.

### 5.1 Units (small, isolated, independently testable)

1. **`mcp/mcp-client.ts`** — pure JSON-RPC transport: `initialise`, `toolsList`,
   `toolsCall`. Holds a per-endpoint session cache. Parses SSE and JSON replies.
   Routing-aware: it is *given* a resolved dispatch descriptor (direct vs proxy +
   credentials) and builds the fetch accordingly. No store/UI dependencies.
2. **`mcp/mcp-connectivity.ts`** — the connection test. Probes `direct` → (if a proxy
   is configured) `proxy`, across URL variants `bare` → `+/mcp`. Returns
   `{ routing, resolvedEndpoint, ok, toolCount, error }`. Pure decision logic over an
   injected probe function (so it is unit-testable without the network).
3. **`mcp/tool-naming.ts`** — pure: `applyPrefix(prefix, toolName)` sanitises to
   `[a-zA-Z0-9_-]`, clips to ≤64 chars; builds the reverse map
   `prefixedName → { serverId, originalName }`; resolves prefix collisions across the
   active server set deterministically.
4. **`integrations/mcp/mcp-integration.ts`** — implements `Integration`. Resolves the
   persona's active servers (default + override), builds the prefixed `Tool[]` from
   each server's **cached** `tools/list`, and each tool's `execute` runs the approval
   gate then calls `mcp-client.toolsCall` through the server's resolved routing.
5. **`data/mcp-servers.ts`** — Dexie CRUD for the `mcpServers` table plus
   read/write helpers for persona overrides and the override-resolution function.
6. **`state/mcp-approval.store.ts`** — the pending-approval queue backing the
   interactive approval pill.
7. **UI**: `components/mcp/McpServersSection.tsx` (settings accordion),
   `components/mcp/McpServerSheet.tsx` (add/edit + test), a persona-editor MCP
   sub-section (tri-state override per server), and the approval pill in the chat.

### 5.2 Routing & the CORS proxy

For `direct`: fetch the server URL directly with the auth header(s) and the MCP
headers (`Accept: application/json, text/event-stream`, `Content-Type`,
`Mcp-Session-Id`).

For `proxy`: route through the user's CORS proxy using the established contract —
`x-cors-proxy-api-key` + `x-cors-proxy-target` (the upstream MCP origin), the request
path carrying the MCP endpoint path, with the auth header forwarded to the upstream
(the proxy already forwards `Authorization`, proven by the LLM providers).

> **🔴 The one real risk — proxy session-header round-trip.** For *session-based* MCP
> servers, the proxy must (a) forward the `Mcp-Session-Id` **request** header to the
> upstream and (b) expose the `mcp-session-id` **response** header back to the browser
> via `Access-Control-Expose-Headers: mcp-session-id`. Streaming and `Authorization`
> forwarding are already proven (ollama-cloud NDJSON via proxy). The session-header
> round-trip cannot be verified from this repo (the proxy is the user's external VPS
> service). **Mitigation:** the connection test makes this visible — if
> `initialise` + `tools/list` succeed direct but fail via proxy on a session server,
> the user sees a clear "your proxy does not pass the MCP session header" message, and
> the proxy needs a one-line update (`Access-Control-Expose-Headers`). **Stateless**
> servers work immediately regardless.

## 6. Data model (Dexie **v17**)

> ⚠️ Current schema is **v16**. MCP owns **v17**. If any parallel work bumps the
> schema, coordinate the version number (see the parallel-feature Dexie ownership
> lesson) — additive merges only, one owner per version.

New table **`mcpServers`**:

```ts
interface McpServerRow {
  id: string;                    // PK, uuid
  name: string;
  url: string;                   // as entered by the user
  prefix: string;                // default = sanitise(name); editable
  auth:
    | { scheme: 'bearer'; key: EncryptedBlob }
    | { scheme: 'header'; headerName: string; key: EncryptedBlob }
    | null;
  onByDefault: boolean;
  autoRun: boolean;              // approval gate disabled for this server
  enabled: boolean;
  routing: 'direct' | 'proxy' | null;   // set by the connection test
  resolvedEndpoint: string | null;      // bare or +/mcp, set by the test
  tools: McpToolDefinition[];           // cached tools/list (name, description, inputSchema)
  hiddenTools: string[];                // originalName[] suppressed from the wire
  lastTestedAt: number | null;
  lastError: string | null;
}
```

The credential `key` is a **MasterKey-sealed `EncryptedBlob`** (mirrors
`ProviderRow.apiKey`), opened only at call time, never persisted or logged in
plaintext.

`PersonaRow` gains **`mcpOverrides?: Record<string, 'on' | 'off'>`** (non-indexed;
the v17 migration backfills `{}` and updates the persona fixtures).

**Resolution** (`resolveActiveServers(persona, servers)`): for each enabled server, an
override entry wins if present; otherwise `server.onByDefault` decides. A server whose
routing is `proxy` but with no proxy configured resolves **unavailable**
(disabled-with-tooltip).

## 7. Tool naming

- Each server carries a `prefix` (default `sanitise(name)`, editable).
- Final wire name = `sanitise(`${prefix}_${originalName}`)` clipped to 64 chars.
- A reverse map `prefixedName → { serverId, originalName }` is built per-send from the
  active servers and used by `dispatch` to route a tool call back to its server.
- Prefix collisions across active servers are resolved deterministically (append a
  short discriminator) so wire names stay unique within a send.

## 8. Connection test (D1 + D3)

Triggered when adding a server and re-runnable from the server sheet at any time.
Sequence (stop at first success):

1. `direct` + `bare URL`
2. `direct` + `URL + /mcp`
3. `proxy` + `bare URL` (only if a CORS proxy is configured)
4. `proxy` + `URL + /mcp` (only if a CORS proxy is configured)

Each probe runs `initialise` then `tools/list`. On success, store `routing`,
`resolvedEndpoint`, and the cached `tools`; clear `lastError`. On total failure, store
a constructive `lastError` (distinguishing "needs a proxy" from "target not in your
proxy's allowlist" from "proxy did not pass the session header" from "unreachable /
not an MCP endpoint"). The server stays usable for re-test.

> **Proxy allowlist.** The reference CORS proxy (`cors-proxy.tidesson.net`) enforces a
> **target allowlist**. A `proxy` probe to a not-yet-allowlisted MCP host fails at the
> proxy, not the upstream — the error message must say so plainly so the user knows to
> add the host to their proxy allowlist (operator action), distinct from a
> session-header gap (a proxy code change). Servers that themselves send permissive
> CORS headers resolve `direct` and never touch the proxy/allowlist at all.

## 9. Data flow (a send with MCP)

1. `buildIntegrationContext` (already carries the CORS proxy + `getKey`) is extended
   with the persona's resolved active MCP servers and their cached tool lists.
2. `resolveActiveTools(ctx, knowledge, expert)` →
   `mcpIntegration.contributesTools(ctx)` returns the prefixed `Tool[]` (hidden tools
   excluded), built from cache — no network here.
3. The model emits a tool call with a prefixed name → the tool-loop `dispatch` finds
   the MCP `Tool` → `execute`.
4. `execute` runs the **approval gate** (§10), then `mcp-client.toolsCall` through the
   server's resolved routing (lazy `ensureSession`), returns the text content as a
   `ToolResult`, which the tool-loop feeds back to the model.

`tools/list` is fetched/cached by the connection test and refreshable on demand; the
live network calls live in `execute` (exactly the web-integration shape).

## 10. Approval gate (the one net-new mechanism)

When a server's `autoRun` is off, `execute` does **not** call the server directly.
Instead it:

1. Enqueues an approval request (server · tool · arguments) in
   `mcp-approval.store.ts`.
2. Renders an **interactive approval pill** in the chat with **Approve** / **Deny**
   and an "always auto-run this server" shortcut (flips `autoRun`).
3. `await`s the user's decision (the pill resolves/rejects the pending promise).

On **Approve** → proceed with `toolsCall`. On **Deny** → return a constructive
`ToolResult` error ("Tool call declined by the user") so the model can react in its
own voice — the *dere* principle. This is the only place the existing tool-loop gains
an interactive pause; the loop itself is unchanged (the pause lives inside `execute`).

## 11. Error handling

- **Proxy required but not configured** → the server's tools are
  disabled-with-tooltip (disabled-over-hidden); the test explains "needs a proxy".
- **Call failures** (timeout, HTTP, JSON-RPC error, `result.isError`) → surfaced as a
  constructive `ToolResult` error in the pill; the model continues.
- **Session 404** → clear the cached session and re-initialise once (ported).
- **Egress** → every MCP call sends arguments (potentially conversation content) to a
  third-party server. A standing note goes in `obsidian/insights/security-deferrals.md`,
  and the settings tab carries a plain-language egress note.

## 12. Security

- Credentials sealed with the MasterKey (`EncryptedBlob`), opened only at call time.
- New outbound egress surface — logged in `security-deferrals.md`.
- **Larissa round** (D10): review the credential sealing/opening path, the approval
  gate (cannot be bypassed; deny truly aborts), and the egress, even though MCP is not
  a §9-gated directory.

## 13. Testing

Pure unit tests:

- `tool-naming` — prefix/sanitise/clip/collision and reverse-map round-trip.
- `mcp-connectivity` — the direct→proxy→variant decision logic over an injected probe.
- `resolveActiveServers` — the default + tri-state-override matrix.
- `mcp-client` JSON-RPC parsing — SSE and JSON replies, session capture, 404 re-init
  (port chatsune's tests).
- approval store — enqueue/resolve/reject; deny returns the constructive error.

**On-device verification only (never in CI — provider/server endpoints never enter
CI, mirroring the curate discipline):** real MCP server behaviour, the proxy
session-header round-trip, and the **multi-turn tool loop** (the model *answers* after
the tool result, not merely that a tool *fires* — the documented web-search lesson).

## 14. Manual verification (device)

1. Add a **stateless public** HTTPS MCP server, no proxy needed → test resolves
   `direct`, tools appear, tool count shown.
2. Add a server that needs a proxy → without a proxy, the test says "needs a proxy"
   and its tools are disabled-with-tooltip; configure the proxy, re-test → resolves
   `proxy` (or surfaces the session-header message if the proxy lacks the expose
   header).
3. Add a server whose endpoint is under `/mcp` but enter the bare URL → the test
   reports it found the endpoint at `+/mcp`.
4. Two servers exporting a same-named tool → both wire names are unique (prefixed).
5. Set a server `onByDefault: true` → a fresh persona has its tools without any
   per-persona action; override a persona to **off** → the tools vanish for that
   persona only; override another to **on** for an `onByDefault: false` server →
   appear there.
6. Server with `autoRun: off` → a tool call shows the approval pill (server · tool ·
   args); **Deny** → the companion explains it could not run the tool; **Approve** →
   it runs and answers. Tap "always auto-run this server" → subsequent calls skip the
   pill.
7. Edit a server's prefix → wire names update; hide a tool → it disappears from the
   model's options.
8. A custom-header auth server → calls authenticate via the configured header.
9. Multi-turn: the companion calls an MCP tool, gets a result, and **answers from it**
   in its own voice across the round.

## 15. Open coordination

- **Dexie v17 ownership** — flag to Chris before any parallel schema work.
- **Proxy allowlist** — for any server resolving `proxy`, its host must be added to
  the user's CORS-proxy allowlist (operator action; the reference proxy is
  `cors-proxy.tidesson.net`). The test surfaces a clear allowlist-miss error.
- **Proxy update** may be needed (`Access-Control-Expose-Headers: mcp-session-id`) for
  session-based servers — surfaced by the test, not assumed up front.
