# Add an MCP connector from the chat — plan

**Spec:** [`superpowers/specs/2026-11-18-add-mcp-connector-design.md`](../specs/2026-11-18-add-mcp-connector-design.md) (approved by Chris, 2026-11-18) · **Branch:** `feat/050-add-mcp-connector` · **Built without the superpowers skills** (the 0.5.0 experiment): the discipline is this file.

## Discipline

- One task at a time, by one subagent, in the main tree on this branch. The subagent never commits, merges, pushes or switches branches; I commit after the review.
- **Test first:** the subagent writes the task's tests, runs them, and records the failing run (the reason must be the missing behaviour, not a typo or an import error of the test itself); then the code; then the passing run. Both runs go into its report, with the command.
- **Review:** a second subagent gets the task text and the diff (not my conclusion), and reports defects. I fix or have them fixed before the next task.
- **Done** means: the task's tests pass, `pnpm exec vitest run <touched test files>` and `pnpm exec tsc -p tsconfig.json --noEmit` in `apps/user-client` are clean, `pnpm exec biome check` on the touched files is clean, the review found nothing open.
- All repository text in British English.

Commands run in `apps/user-client` unless stated. Baseline 2026-11-18: 675 files, 4687 tests passed.

---

## T1 — Link rules (pure)

**Files:** `src/tools/connector-link.ts` (new), `tests/tools/connector-link.test.ts` (new).

**What:** the spec's §2.4 rules 2–8 as pure functions.
- `normaliseConnectorLink(raw: string): { ok: true; url: string; host: string } | { ok: false; reason: 'invalid' | 'not-https' | 'userinfo' | 'fragment' | 'not-public' | 'too-long' }`: trim; prepend `https://` when there is no scheme; `new URL`; `href`; rules in the spec's order (https, userinfo, fragment, public host, length ≤ 2,048 on the `href`).
  - Not public: IPv4 and IPv6 literals, `localhost`, single-label hosts, suffixes `.local`, `.localhost`, `.internal`, `.lan`, `.home.arpa` (case-insensitive; a trailing dot on the host is treated as absent).
- `linksInText(text: string): string[]`: finds `https?://…` and bare `host.tld/…` links, strips trailing `.,;:!?)]}>'"`.
- `userWroteLink(url: string, userTexts: readonly string[]): boolean`: true when a link found in any text, normalised by `normaliseConnectorLink`, equals `url`, ignoring one trailing slash on either side.
- `emphasisSplit(host: string): { lead: string; tail: string }`: the last two labels as `tail` (for §4.1).

**Tests:** each rule with a passing and a failing example; IDN → punycode; non-ASCII path percent-encoded; missing scheme; trailing space and slash; userinfo (`user@`, `user:pw@`); `#frag`; `127.0.0.1`, `[::1]`, `localhost`, `printer`, `nas.local`, `x.home.arpa`, `x.internal`; 2,049 characters; `linksInText` with punctuation, parentheses, several links, a bare host; `userWroteLink` true for an earlier text, false when only elsewhere.

**Done:** as above.

## T2 — `findServerForLink`

**Files:** `src/mcp/find-server-for-link.ts` (new), `tests/mcp/find-server-for-link.test.ts` (new).

**What:** §4.3: the first row whose `canonicalResource(row.url)` equals the canonical form of the link or of the link + `/mcp` (no double `/mcp`); a row whose URL throws is skipped.

**Tests:** exact, `/mcp` variant, trailing slash, other path, other host, malformed row skipped (no throw), first of two matches by `createdAt` order of the input.

## T3 — The tool, its registration and the cache pin

**Files:** `src/tools/add-mcp-connector.ts` (new), `src/tools/builtin-tool-names.ts`, `src/tools/registry.ts`, `src/state/stream-manager.store.ts` (wiring only), `tests/tools/add-mcp-connector.test.ts` (new), `tests/tools/registry.test.ts`, `tests/tools/builtin-tool-names.test.ts`.

**What:** §2.1–2.4, §7.
- `contributeConnectorTool(ctx: { userTexts: () => readonly string[]; servers: () => Promise<McpServerRow[]> }): Tool` with the constant definition, description and `SYSTEM_INSTRUCTION` exactly as in the spec; `execute` per the rule order and the output table (the constants verbatim); a per-instance call counter (every call counts; at most one successful proposal; the third call fails); `meta` exactly `{ connector: { url } }` on a proposal and on "already exists", none otherwise (amended after T3: the *Added* card needs the link); seed turns do not count as user text (`connectorUserTexts`); no `fetch`.
- `BUILTIN_TOOL_NAMES` gains `add_mcp_connector`.
- `resolveActiveTools` takes an optional connector context and places the tool directly after `calculate_js`; it is present whenever a context is given; the send path always gives one when tools are active (user texts: the chat's prior user messages plus the current one, as the send path holds them; servers: the `mcpServers` table ordered by `createdAt`).
- Cache pin: a test that builds the active tools twice with different contexts (different user texts, rows) and asserts byte-identical `toolDefs(...)` and `systemPromptSegment(...)`.

**Tests:** every table row; the cap; `fetch` spy untouched; the registry position and the constants; the cache pin.

## T4 — Redirects refused legibly: transport and check

**Files:** `src/mcp/mcp-client.ts`, `src/mcp/mcp-connectivity.ts`, `src/mcp/types.ts` (if the probe result needs a field), `src/mcp/oauth/check-server.ts`, `src/components/mcp/CheckServerStep.tsx`, `src/mcp/redirect-copy.ts` (new: the constants), tests beside the existing ones (`tests/mcp/mcp-client.test.ts`, `tests/mcp/mcp-connectivity.test.ts`, `tests/mcp/oauth/check-server.test.ts`, the CheckServerStep test if one exists, else new).

**What:** §6.3 rows 1–2.
- `buildRequest`: `redirect: 'manual'` on both routes, always.
- `send`: an opaque redirect (`isOpaqueRedirect`) on either route throws `McpRedirectError` (new, exported from `mcp-client.ts`, message `MCP_REDIRECT_DETAIL`).
- `liveProbe`: maps `McpRedirectError` to a probe result flagged as redirect (a `redirect: true` field), `error` the detail sentence.
- `checkServer`: when the last failing candidate was a redirect and nothing answered, `unreachable` with `cause: 'redirect'` and the check sentence; `CheckServerStep` shows it with *Try again* (no "Couldn't reach").
- `testMcpConnection` / `resolveConnection`: the detail sentence lands in `error`, so `lastError` and the status line read "✗ This server answered with a redirect, which Chatsundere doesn't follow. Enter its final link."

**Tests:** `redirect: 'manual'` for direct with and without auth and for proxy; opaque redirect → `McpRedirectError` on both routes; a `TypeError` network failure is not one; probe flag; check result cause and the step's copy; connection result error text.

## T5 — Redirects refused legibly: tool calls in the chat

**Files:** `src/mcp/mcp-tools.ts`, `src/components/chat/Pill.tsx`, `src/components/mcp/McpRedirectNotice.tsx` (new), tests beside the existing (`tests/mcp/mcp-tools.test.ts`, `tests/components/chat/Pill.test.tsx`).

**What:** §6.3 row 3 and "Running chats": a tool call that hits `McpRedirectError` returns `ok: false`, error the constant `<server.name> answered with a redirect, which Chatsundere doesn't follow. Tell the user to open the server in My Integrations and enter its final link; do not retry this tool in this turn.`, with `meta: { mcpRedirect: { serverId, serverName } }`; the pill shows "<name> answered with a redirect, which Chatsundere doesn't follow." with *Open <name>* → `/app/integrations/<id>?return=<current chat path>`.

**Fallback (spec):** if the notice needs more than this, drop the notice and keep the constant result; say so.

## T6 — The connector card

**Files:** `src/components/chat/ConnectorPill.tsx` (new), `src/components/chat/Pill.tsx` (dispatch), `src/data/connector-pill.ts` (new: `dismissConnectorPill(pillId)`, modelled on `writeReplaySummary`), `src/index.css` (card styles), `tests/components/chat/ConnectorPill.test.tsx` (new), `tests/data/connector-pill.test.ts` (new).

**What:** §4 entirely: layout, plain-text link, host with emphasised tail, every state of §4.2 with its copy and actions, re-validation of the stored link, *Failed* showing the host only, `chatPath` from the message row's chat (encoded), *Enter passphrase* via `passphraseLoginPath`, *Not now* writing only `connectorDismissedAt` (and enqueuing the pill for sync as `writeReplaySummary` does), the navigate call of §5.1.

**Tests:** every state; link not an anchor and unshortened; crafted payloads; dismissal writes only that field; navigate path and state.

## T7 — The prefilled *Add server*

**Files:** `src/routes/app/integrations/server.tsx`, `src/components/mcp/CheckServerStep.tsx`, `src/components/mcp/SignInSettings.tsx`, `tests/component/integration-server.test.tsx` (extend) and new focused tests if cleaner.

**What:** §5.2, §5.3: read and validate `proposedLink` (ignored with `useKeyFor`), consume the state (`replace`, `state: null`), keep `fromChat`; auto-check once; field read-only and "Checking <host>…" while checking (`CheckServerStep` gains `autoCheck` and the read-only behaviour); the "Suggested in the chat…" line above the field and on the following screen, dropped after an edit; `SignInSettings` in proposal mode puts *Tool prefix* and *Local network* behind "More settings"; the form seeds name = host and *On by default* ticked after a proposal only.

## T8 — The way back

**Files:** `src/routes/app/integrations/server.tsx`, `src/routes/app/integrations/sign-in.tsx`, `src/components/mcp/CheckServerStep.tsx`, tests as in T7 plus the waiting-screen test.

**What:** §5.5's table, every row: `returnTo` read with `safeReturnPath(…, null)` (or an equivalent that yields "none"), handed to `IntegrationServerForm`, the toasts, *Link a server* with `?return=<chatPath>` in proposal mode, the waiting screen's `?return=` on connected, saving later, *Cancel* and *Use a key instead*; `PageScaffold back` from `returnTo`. `PageBar` and `PageScaffold` untouched. **Also the detail route** (`/app/integrations/:serverId`, added after the T5 review): `IntegrationServerForm`'s `back`, *Save* and *Remove* honour `?return=`, so the redirect notice's *Open <name>* and the card's *Open* come back to the chat.

---

## After the tasks

1. A whole-branch review by a fresh subagent against the spec.
2. Gates from the root: `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm lint` (Biome).
3. Laura's pre-squash pass; the Larissa-style read of the diff.
4. Merge `master` (and #58 once merged); last commit not `[skip ci]`; PR ready; report.
