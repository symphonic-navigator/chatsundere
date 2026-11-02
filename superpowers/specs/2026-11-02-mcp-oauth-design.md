# OAuth for MCP connectors — design

**Date:** 2026-11-02. **Status:** approved by Chris; Laura's spec-pass findings folded in.
**Supersedes:** decision D7 ("OAuth deferred") of `superpowers/specs/2026-06-08-mcp-client-design.md`.
**Paths touched:** `apps/user-client/**`, `apps/proxy-service/**` and `packages/shared-types/**`. The proxy and the new sync collection make this a **Larissa** unit; the new flow makes it a **Laura** unit.

## 1. Intent

Chatsundere becomes an OAuth client for MCP servers, in the role claude.ai and ChatGPT play. A user pastes a server link, signs in at that server, and the connection works on all their devices. The feature is **generic**: it follows the MCP authorisation specification and assumes nothing specific to any one server. Kumbu² is the first test partner, not the target.

Why it matters: most hosted MCP servers worth connecting to expect OAuth, and today users can only paste static keys.

### Goals

- Connect any spec-following MCP server with a link and a sign-in, in the installed PWA and in the browser, on Linux, macOS, Windows, Android and iPhone.
- One connection per account, not per device: tokens sync through the backend as ciphertext.
- A device that was offline, or a device that crashed, must never cause a server to revoke the connection when that can be avoided.
- An honest message for every failure, including a server that only admits approved apps.
- Close the remainder of security deferral M1 of 2026-11-02 (first-use consent and the origin in approval prompts).

### Non-goals

- A promised list of supported servers. We promise spec adherence and honest errors. Some servers refuse unknown clients (Figma's catalogue, Intercom's redirect allowlist), and we cannot solve that from our side.
- A field for a manually entered client ID. It is too technical for this audience and can be added later.
- Per-tool "Allow always". Chris's call: it stays per server (Pareto); fine-grained control only if someone asks.
- A relay that carries the sign-in code through the backend, or a short typed code. Follow-up, only if the iPhone device test shows copy and paste is annoying (see §12).
- Raising the MCP protocol version to `2026-07-28` (`server/discover`). Follow-up, unless Notion or GitHub force it in the device test.
- The agentic loop spec (context budget, checkpoints) and the other deferrals of 2026-11-02 (M2, L2, L-http, L4).

### Anti-goals

- The backend must never be able to read a token, a code or a verifier at rest. The proxy sees them in transit only, as it sees API keys today (§8), and never stores or logs them.
- A raw OAuth error shown to the user is a failure of this feature.
- A token sent anywhere other than the origin it belongs to is a stop-the-line defect.

## 2. Decisions

**Chris decided:**

- Tokens sync through the backend between devices; no per-device tokens.
- Falling back to "Sign in again" is acceptable when a device dies in the middle of a refresh.
- CIMD with DCR as the fallback is central (he has been bitten by this while testing Kumbu² against ChatGPT).
- The success measure is spec adherence, plus Kumbu², Notion and GitHub in his device test.
- Sign-in in its own window, with a visible copy-and-paste code as the fallback.
- "Allow always" stays per server.
- A key can still be entered on a server that offers OAuth (*Use a key instead*).
- A server connected by sign-in starts on by default.
- First-use consent and the origin in prompts are in scope, for OAuth and key servers alike.
- Tokens travelling through the proxy in plaintext, as API keys do, is accepted and recorded in an ADR.

**Liz's calls, approved in discussion:** the claim model (§5), `nginx` generating the client metadata (§6), direct OAuth requests where possible (§7), staying on protocol `2025-06-18`, the status and error states (§9).

**Liz's calls, for Chris to check while reading:** marked "(Liz)" where they appear. §9 is the complete UX contract; the discussion mockups are not needed to build this.

**Left to the builder:** file layout, module names, exact English copy within the meaning given here (Laura reviews it before the squash), test fixture shape, and the wording of the ADR.

## 3. End-to-end example

Ann uses the installed PWA on her iPhone and a browser on her Linux PC, both linked to one account. Her Kumbu² connection has the link `https://kumbu.example/mcp/c/abcdefghijklmnop`.

1. **Connect, on the iPhone.** Ann pastes the link in *My Integrations → Add server* and taps *Check server*. The proxy returns the server's 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="kumbu:read kumbu:write"`. The app reads the protected resource metadata (its `resource` equals the link), then the authorisation server metadata, and shows `Sign-in required`.
2. **Confirm.** The dialog names `kumbu.example` as the server and as the place she signs in. She taps *Continue to sign-in*. The app seals the pending sign-in (verifier, state and so on) into a device-local row and opens the authorisation URL with `window.open(url, '_blank', 'noopener')`.
3. **Sign in.** Kumbu² fetches `https://app.example/oauth/client-metadata.json`, shows its consent screen, and redirects to `https://app.example/oauth/callback?code=…&state=…&iss=https://kumbu.example`.
4. **Return.** The callback page posts the result on a `BroadcastChannel` and waits about 1.5 s for an acknowledgement. On the iPhone nothing answers, so it shows `Almost there` with the code `csm1.…` and a *Copy code* button.
5. **Finish.** Ann goes back to the PWA, which still shows `Waiting for sign-in…`, pastes the code and taps *Finish*. The app checks `state` and `iss`, then exchanges the code within Kumbu²'s 60 seconds. The token endpoint allows CORS, so this goes directly from the browser, and the app records `tokenRoute: 'direct'`.
6. **Store.** The app writes the new `mcpOAuthGrants` row with the tokens sealed under the master key, pushes it, lists the tools and saves the server. The status reads `● Connected`.
7. **Second device.** Ann opens a chat on the PC. Sync has delivered both rows. On the first tool call the app asks `Use this server here?`, naming `kumbu.example`. She agrees. The call runs with the synced access token through the proxy: this row has `allowDirect` off, and `/mcp/c/…` has no CORS in any case.
8. **Refresh.** An hour later the access token has expired and the PC needs it. Under a Web Lock, the PC pushes the grant row with a sealed claim and `baseRev` = its known revision. The push returns `ok`. It presents the refresh token, stores the new pair locally, then pushes the row with the new tokens and no claim.
9. **Offline device.** The iPhone has been offline and holds the old refresh token. Back online, with an expired access token and before a pull has arrived, it tries to claim. The push returns `conflict` with the current record. It opens that record and uses the new tokens. The old refresh token never reaches Kumbu².

## 4. Data model

### 4.1 New synced collection `mcpOAuthGrants`

One row per OAuth server, its `id` being the server's id. Add the name to `SYNC_COLLECTIONS` (`packages/shared-types/src/sync.ts:4`), which is also what `apps/sync-service/src/routes/changes.ts:34` validates against, and a Dexie version bump after v37 for the table. Add it to `BACKFILL_ORDER` (`apps/user-client/src/sync/backfill.ts:54`) after `mcpServers`, so a local account that links later uploads its grants.

| Field | Meaning |
|---|---|
| `id` | The `McpServerRow.id` |
| `resource` | Canonical MCP URL the grant is bound to |
| `issuer` | Authorisation server issuer |
| `tokenEndpoint`, `revocationEndpoint` | Pinned at connect; never rediscovered on refresh |
| `clientId`, `registration` | The client id used and how it was obtained (`cimd` or `dcr`) |
| `scope` | Scope granted |
| `tokenRoute` | `direct` or `proxy` (§7) |
| `tokens` | `EncryptedBlob`: sealed `{ accessToken, refreshToken \| null, accessExpiresAt \| null }` |
| `claim` | `{ deviceId, until } \| null`: the refresh claim (§5) |
| `createdAt`, `updatedAt` | As other rows |

Tokens are sealed with `sealSecret` under a stable slot, in the same way as `sealMcpKey` (`apps/user-client/src/data/mcp-servers.ts:81`), and the whole row is sealed by the sync engine on top.

Device-local fields, deny-listed in `apps/user-client/src/sync/strip.ts`:

- `pendingTokens`: the write-ahead copy of a fresh token pair not yet pushed.

This collection takes **no** LWW resolution: it must be left out of `LWW_COLLECTIONS` (`apps/user-client/src/sync/resolution.ts:34`). A pulled row always replaces the local one, except that `pendingTokens` survives until its own push has been decided. The grant's writes go through the path in §5, not through the outbox, apart from delete and backfill.

### 4.2 Changes to `McpServerRow`

- `auth` gains `{ scheme: 'oauth' }`. No secret lives in this row.
- `firstUseConsentFor: string | null`: device-local (deny-listed in `strip.ts` and added to `FRESH_DEVICE_DEFAULTS`). It holds the URL this device was approved for. It resets by itself on a URL change because `url` is already in `LOCAL_VALUES_DERIVED_FROM`.
- For an OAuth server the URL is read-only, with a disabled reason ("To change the link, remove this server and connect it again"). (Liz)

### 4.3 Device-local table `mcpOAuthPending`

Holds the state of a sign-in in progress: `state`, `codeVerifier`, `serverId` or draft server fields, `resource`, `issuer`, endpoints, `clientId`, `registration`, `createdAt`. Sealed under the master key, never synced, deleted on completion, cancellation, or after 10 minutes.

## 5. Refresh serialisation (the core)

**Invariant:** a device presents a refresh token only after the sync server has confirmed, by compare-and-set on the grant row, that this device holds the current revision and owns the claim.

The sync server already does per-record compare-and-set: a push whose `baseRev` differs returns `conflict` with the current record (`apps/sync-service/src/records/store.ts:199`). **No new server logic is needed**, and the server sees only ciphertext and revisions. It does need a direct push path on the client that returns the per-record result to the caller and does not go through the outbox (build on `defaultPush` and `prepareRecord` in `apps/user-client/src/sync/worker.ts`).

Why this is strict: Kumbu² revokes the whole connection's tokens if a used refresh token arrives after its 30-second grace period, and also if a token from an **earlier** sign-in arrives while a newer family is live (`OAuthTokens.cs:402`, `:418`). Other servers may have no grace period at all.

### Algorithm, on a linked device

1. Take a Web Lock named per grant; this also serialises tabs.
2. If the local row has a valid access token, or a newer row arrived while waiting, use it and stop.
3. **Claim.** Push the row with `claim = { deviceId, until: now + 60 s }` and the known `baseRev`.
   - `conflict`: adopt the returned record and go back to step 2. A foreign claim that is still valid means wait and poll until it clears or expires. An expired claim may be overwritten with another compare-and-set push.
   - Network failure: stop. The status is `○ Waiting for your server`, and the tool call fails honestly.
4. **Refresh.** POST `grant_type=refresh_token` with `client_id` and `resource` over `tokenRoute`.
5. **Write ahead.** Store the new pair in `pendingTokens` first.
6. **Publish.** Push the row with the new sealed tokens and `claim = null`, using the revision returned by step 3. Clear `pendingTokens` on `ok`. On a network failure, retry at every later sync opportunity.
7. **Conflict at publish.** This can only follow a claim that was overwritten after expiry. The device with the newer revision wins; adopt it, and discard `pendingTokens`.

Behaviour of the token response, none of it Kumbu-specific:

- A new `refresh_token` in the response replaces the old one. If there is none, the old one stays.
- `invalid_grant`: the grant is dead. Write `tokens = null`, push, and show `⚠ Sign in again`.
- No refresh token held at all: when the access token expires, `⚠ Sign in again`.
- A lost response (timeout or network error after sending): retry with the same token within 25 s of the first send, on the same route. After that, treat the state as in doubt: clear the claim and leave the row. The next attempt may succeed or end in `invalid_grant`, and both outcomes are handled.

Refresh runs only on demand: when a tool call or list needs a token that expires within 60 s, or reactively on a 401. A reactive 401 refreshes once per call. No background refresh.

### On an unlinked (local-only) device

The Web Lock alone serialises. There is no claim, and the grant is a plain local write. Linking later uploads the grant through backfill.

### Accepted failure modes

- **Backend unreachable and access token expired:** no refresh, deliberately. A stale refresh could revoke the connection.
- **Device dies between steps 4 and 6:** the claim expires, another device presents the old token. On Kumbu², that is a revocation if more than 30 s have passed, then `⚠ Sign in again`. Chris accepted this.
- **Hostile sync server replays an old row:** a device might present an old token and cause a revocation. That is denial of service only. It cannot read tokens. Larissa to confirm against rollback deferral L4.

## 6. Client identity

Priority as in the specification: CIMD if the server advertises `client_id_metadata_document_supported: true` **and** the app's origin is publicly fetchable, then DCR if a `registration_endpoint` exists, otherwise an honest message ("This server only accepts approved apps").

**What the app can and cannot observe.** The honest message appears for what the app can see: no registration method, a refused registration, or a callback carrying an `error`. A server that rejects `client_id` or `redirect_uri` shows its own error page in the sign-in window and never redirects, so the app cannot know. The waiting screen therefore always offers a way out (§9). The client identity is chosen up front, never by retrying after an unobservable failure. (Liz)

**CIMD.** `apps/user-client/nginx.conf` serves `location = /oauth/client-metadata.json` as JSON generated from the request's own host:

```json
{
  "client_id": "https://<host>/oauth/client-metadata.json",
  "client_name": "Chatsundere",
  "client_uri": "https://<host>",
  "redirect_uris": ["https://<host>/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

So self-hosters configure nothing, and `APP_PUBLIC_URL` stays with the auth-service. The `client_id` must match the fetched URL exactly, **including a non-default port**: verify this against what `$host` and `$http_host` provide behind Traefik and against a malformed `Host` header, because nginx places the value inside a JSON string. The Vite dev server serves the same document through a small middleware.

The browser's `client_id` is `location.origin + '/oauth/client-metadata.json'`. An instance on a loopback or private origin cannot be fetched by a public server, so the app goes straight to DCR there. (Liz)

**DCR.** `POST registration_endpoint` as a public client (`token_endpoint_auth_method: none`). If the answer requires a client secret, refuse with the honest error. The resulting `client_id` lives in the grant, so all devices share it.

## 7. Discovery and network routes

### Discovery, as the specification orders it

1. Probe the server. A **401** starts OAuth; a `200` with an error does not. Parse `WWW-Authenticate` with a real challenge parser.
2. Protected resource metadata: `resource_metadata` from the challenge, then `/.well-known/oauth-protected-resource/<path>`, then `/.well-known/oauth-protected-resource`.
3. Its `resource` must canonically equal the user's URL (lowercase scheme and host, no default port, one trailing slash dropped, path compared exactly). A mismatch stops with an error.
4. Authorisation server: the first entry of `authorization_servers`. Metadata via RFC 8414 and OIDC Discovery in the specification's order. `issuer` must be identical to the one the URL was built from.
5. Scope: challenge, then `scopes_supported`, then none. Append `offline_access` if the **authorisation server** lists it.

A 401 with no OAuth metadata anywhere is treated as a key server: the key field appears as today. This is the expected result for Kumbu²'s plain `/mcp` (`Discovery.cs:11`).

`buildCandidates` (`apps/user-client/src/mcp/mcp-connectivity.ts:16`) may append `/mcp`; the URL that answered the probe becomes the `resource`.

### Routes

The MCP endpoint keeps its existing rules (`allowDirect`, proxy) unchanged. OAuth requests (metadata, registration, token, revocation) go **direct from the browser where the authorisation server allows CORS, otherwise through the proxy**, so that tokens avoid the proxy where possible.

**Trap, and the required handling:** a form-encoded POST is a CORS "simple" request, so the browser sends it **without a preflight** and only hides the response afterwards. A refresh token sent that way is spent and its answer lost. Therefore:

- Every direct OAuth POST carries the `MCP-Protocol-Version` header, which forces a preflight. A refused preflight sends nothing, and then the proxy is safe to try.
- The route is decided once, during the code exchange, where a lost attempt only means "start the sign-in again". It is stored as `tokenRoute`.
- A refresh never switches route. If `tokenRoute` is `direct` and fails at network level, the §5 in-doubt rules apply.
- If `tokenRoute` is `proxy` and the device has no proxy, the status is `○ Waiting for your server`.

Direct requests use `redirect: 'error'`. The sign-in itself runs in the user's browser and is never proxied.

### Proxy changes (Larissa path)

- `apps/proxy-service/src/routes/proxy.ts:221`: add `Access-Control-Expose-Headers: Mcp-Session-Id, WWW-Authenticate` to the forwarded response. This is where it must go. Today the header is set only on the preflight (`apps/proxy-service/src/cors.ts:42`), where it has no effect, so `Mcp-Session-Id` has **never** been readable through the proxy; stateful servers lost their session there. `applyCorsHeaders` serves only error responses and needs no change.
- Client: `apps/user-client/src/mcp/mcp-client.ts` sends `x-cors-proxy-kind: mcp` for MCP and OAuth requests, so that they are counted as `mcp` in the metrics (it currently sends none).
- Client: send `MCP-Protocol-Version: 2025-06-18` on requests after `initialize`, once the requirement is verified against the 2025-06-18 specification.
- Check that `fetchWithProxyAuth` retries (account token refresh) do not resend a **consumed** OAuth request: a proxy-level 401 is fine to retry; the upstream's answer is not.

### Local-only users without a proxy

Connecting requires CORS on both the MCP endpoint and the authorisation server. (Liz)

- *Check server* on a device without a proxy probes an `https` link directly, without asking for the "Local network" toggle. No credential is sent by this probe. This is a change to the early stop at `apps/user-client/src/routes/app/integrations/server.tsx:141`.
- A blocked read cannot be told apart from a server that is down, because the browser hides the 401. So the honest result is: "Couldn't reach this server directly. It may only work through a linked Chatsundere server", with a pointer to linking and the manual-details path (§9). This replaces any promise of a greyed sign-in option. Kumbu²'s `/mcp/c/…` ends here.
- A successful direct connect sets the synced `allowDirect` to true, and `buildCandidates` then tries direct and proxy as it already does.

**First use on other devices.** `canResolveOnFirstUse` (`apps/user-client/src/mcp/resolve-active.ts:33`) excludes `allowDirect` rows because a local address could answer on another network. For an OAuth server the URL is HTTPS and the token chokepoint binds the grant to it, so OAuth rows may resolve on first use whether `allowDirect` is set or not. Larissa checks this exception. (Liz)

## 8. Security requirements

Enforced in client code, each with a test:

- **PKCE S256 only.** If `code_challenge_methods_supported` is absent or lacks `S256`, refuse.
- **`resource`** in both the authorisation and the token request.
- **`state`:** 256-bit random, exact match against a pending row. A pasted code with an unknown `state` is refused, which also stops someone being tricked into pasting an attacker's code.
- **`iss`:** must equal the issuer when present, and is required if the server advertises `authorization_response_iss_parameter_supported`.
- **HTTPS only** for all OAuth endpoints and the MCP URL of an OAuth server. Loopback `http` only in development builds. In particular, `authorization_endpoint` is validated before `window.open`, so a hostile server cannot supply a `javascript:` URL.
- **Token chokepoint**, like `usableRoute` (`apps/user-client/src/mcp/resolve-active.ts:13`): the access token is sent only to the grant's `resource`, and the refresh token only to its pinned `tokenEndpoint`. A row whose URL no longer matches the grant sends nothing.
- **Callback page:** a small standalone static page, not an SPA route, because `apps/user-client/index.html` loads Google Fonts and the service worker's navigation fallback would answer the path from the cached shell without these headers. Add `^/oauth/` to `navigateFallbackDenylist` (`apps/user-client/vite.config.ts:147`) and make this path resolve in `nginx`. It removes the code from the address bar with `history.replaceState`, sends `Referrer-Policy: no-referrer`, loads nothing third-party, needs no session, and has `access_log off`, because the query holds a code. Its look comes from a few inline styles matching the app's colours, with system fonts. (Liz)
- **Logging:** tokens, codes and verifiers never reach logs or `console.*`, `toString`, or error messages. The MCP call error must not echo a request.
- **Plaintext through the proxy (accepted, ADR):** code, verifier and tokens pass through the proxy in memory when the direct route is unavailable, as Bearer keys do today. Tool calls usually carry the access token through it. It neither stores nor logs them.
- **Remove server:** best-effort RFC 7009 revocation of the refresh token, then delete both rows via sync. There is one action with this one name. The confirmation says it applies to all devices and signs out at the server; if revocation fails, the app says so rather than implying it worked.

### M1 remainder, closing the deferral

- **Origin in every approval prompt.** `McpApprovalPrompt` (`apps/user-client/src/components/mcp/McpApprovalPrompt.tsx`) shows the server's host, keeping the existing arguments, Approve, Deny and "Always allow". "Always allow" keeps flipping `autoRun` for the whole server, as at line 27.
- **First-use consent per device**, for OAuth and key servers alike, also under `autoRun`: before the first contact from a device, unless `firstUseConsentFor` equals the row's URL. This happens in the tool's `execute` in `apps/user-client/src/mcp/mcp-tools.ts:113`, before the key or token is opened. Existing users meet this once per device and server after updating; that is expected.
- **Only one prompt per call.** (Liz) On a server without `autoRun`, the approval prompt also carries the first-use wording ("This device hasn't contacted this server yet") and approving counts as consent. Only under `autoRun` does a separate `Use this server here?` appear. Connecting on a device and a successful *Test* on it count as consent too. *Deny* or *Not now* answers that tool call only and stores nothing; the prompt returns on the next call.

Update `obsidian/insights/security-deferrals.md` and `follow-ups-index.md` accordingly.

## 9. User experience

The behaviour, with copy as a draft. Laura's spec-pass findings are folded in here.

### Connect

1. *Add server* opens with the link field and *Check server*. All further fields appear after the check. Outcomes:
   - **Sign-in required:** continue with step 2. A quiet *Use a key instead* reveals today's key fields (scheme and custom header stay).
   - **No OAuth metadata, 401:** the key fields, as today.
   - **No auth needed:** continue to settings, with a visible *Add a key*, because a server may answer `initialize` openly and still want a key for its tools.
   - **Unreachable, timeout, other errors:** an honest message, *Try again*, and *Enter details manually*, which reveals today's whole form. Saving a server that is down right now stays possible, and home-network servers depend on it. The "Local network" toggle sits in this manual path, ahead of the probe.
2. A name is prefilled from `resource_name` or the host and stays editable. Two connections to one host must end up with distinct tool prefixes (check `apps/user-client/src/mcp/tool-naming.ts`). Prefix, Trusted, On by default and Local network appear with today's meanings alongside the result. **On by default starts on for a server connected by sign-in** (Chris's decision), because someone who deliberately signed in wants to use it; the approval prompt stays as the guard. Key servers keep today's default of off.
3. Confirmation names the server's host and the sign-in host, says access applies on all devices, and warns to connect only trusted servers. All preparation (registration, sealing) finishes **before** *Continue to sign-in* is enabled, because iOS is strict about stale gestures. That button is the gesture for the window.
4. `Waiting for sign-in…`: continues by itself. The screen has:
   - *Open sign-in again*, reusing the pending sign-in, with the wording "Nothing opened?", since a blocked window cannot be detected through `noopener`.
   - The paste field ("Sign-in showed you a code?"), **always** visible. A valid `csm1.` paste finishes by itself; *Finish* stays for those who look for it.
   - "Did the sign-in page show an error? Some servers only accept approved apps", with *Use a key instead*.
   - *Cancel*, which deletes the pending row.
5. **Case A, the window reaches the app:** the callback page closes itself or, if the browser refuses, reads "You're connected. Return to Chatsundere", which may be the usual path. The app continues to `● Connected`, with the tools listed.
6. **Case B, the window is separated from the app:** the callback page shows the code and *Copy code*, with a note that some servers only accept it for about a minute and that starting again is fine. After pasting, the same `● Connected` state. A late acknowledgement switches the page to "Done".

Detection: the callback posts on a `BroadcastChannel`. The waiting tab acknowledges, and without an acknowledgement after about 1.5 s the page shows the code. `window.opener` cannot be used, because the app sets COOP `same-origin` (`nginx.conf:15`) and the window is opened with `noopener`. Only the tab holding the pending sign-in acts, and the exchange runs under a Web Lock, so two tabs never both spend a code.

The pasted format is `csm1.` plus base64url of `{ code, state, iss }`, or of `{ error, state }` for a sign-in that failed. It is long and meant to be copied, not typed.

### When a sign-in does not succeed

- **The user declines, or the server returns an `error`:** the callback page says "Sign-in was cancelled. Go back to Chatsundere to try again". A connected tab shows the reason, and a separated one receives it through the paste field. Raw error codes are not shown.
- **Exchange fails:** expired code, or a server refusal. The waiting screen says so plainly and offers *Start again*. The pending row survives a failed exchange.
- **A pasted code for a sign-in already finished:** "Already connected". **A pasted code with an unknown `state`, or a malformed one:** "This code doesn't belong to this sign-in".
- **10 minutes elapsed:** the visible screen moves by itself to "Sign-in expired" with *Start again*.

### Leaving and returning

Going back from the waiting screen keeps the pending sign-in; only *Cancel* deletes it. A pending sign-in shows as a row in My Integrations (`○ Sign-in in progress`) that leads back to the waiting screen, so the paste field stays reachable. If the app tab was killed, the pending row survives unlocking: within 2 minutes the app returns to the waiting screen by itself, otherwise the row waits in the list. (Liz)

### Status in My Integrations

| Status | Meaning |
|---|---|
| `● Connected` | As today |
| `○ Connects on first use` | As today; applies to an OAuth server on a device without a route, **or whose grant row hasn't arrived yet** |
| `○ Sign-in in progress` | A pending sign-in on this device |
| `⚠ Sign in again` | `tokens` is null; never shown just because a grant row is missing |
| `○ Waiting for your Chatsundere server` | The token needs renewing and the backend or proxy is unreachable; on a device with no proxy at all, it says linking is needed instead |

These take precedence over today's `✗ Not tested`, `✗ Needs proxy` and `✗ <lastError>` for OAuth rows (`apps/user-client/src/routes/app/integrations.tsx:13`).

### Detail page of an OAuth server

The list row always navigates; it holds no nested button. The detail page leads with the connection state and "Signed in at <host>", with a primary *Sign in again* when the grant is dead. The auth select is replaced by this read-only line. *Saving must never disturb the grant*: `onSave` (`apps/user-client/src/routes/app/integrations/server.tsx:212`) keeps `{ scheme: 'oauth' }`. *Test connection* uses the grant's token, through the same refresh path. Reconnecting replaces the grant (new sign-in, same row, same settings).

The *Sign in again* flow must not start while the backend is merely unreachable: a new family could compete with a live one. It is disabled with the reason in that state.

### In a chat

If a token is unavailable, the tool does not run. The model gets an error matching the variant below, telling it not to retry this turn, and the turn continues. There is one pill per server per turn, and it reads the current grant state, so an old pill stops offering a sign-in after recovery.

| Situation | Pill | Action |
|---|---|---|
| Grant dead | `⚠ <server>: sign-in ended` | *Sign in again* |
| Backend unreachable, or refresh in doubt | `○ <server>: can't renew access right now` | None; try again shortly |
| `403` with `insufficient_scope` | `⚠ <server>: needs more access` | *Grant access*: the sign-in requests the union of the granted and challenged scopes |

Any other `403` is an ordinary tool error. Waiting on another device's claim shows a quiet "Renewing access…" rather than a silent pause.

**No window opens by itself, and nothing re-runs automatically** after signing in, because a tool may already have had side effects; the user asks again.

**The action opens an overlay above the chat**, using the same components as the Integrations flow (confirmation, waiting screen, paste field). The chat, its draft and any pending approval stay intact. On success, it closes and says "Connected. Ask again whenever you like". (Liz)

## 10. Testing

- **Test authorisation server fixture** inside the user-client tests, driving the real client code: full happy path; no grace period; no refresh token; no rotation; DCR only; CIMD only; neither; missing PKCE; wrong `issuer`; wrong `iss`; PRM `resource` mismatch; non-HTTPS endpoints; `javascript:` authorisation endpoint; `insufficient_scope`; `invalid_grant`; callback with `error`; expired code; pending row expiring; a code pasted twice, malformed, or with an unknown `state`; two tabs on one result.
- **Claim model** against the real compare-and-set semantics, using `apps/sync-service/src/records/store.ts` behaviour: two devices racing; a stale offline device; a crash between refresh and publish; an expired foreign claim; publish conflict; pull during `pendingTokens`; local-only device; two tabs.
- **Proxy:** the exposed headers appear on a forwarded response (`apps/proxy-service/tests/proxy.test.ts`).
- **Regression:** key-based MCP servers behave as before, except for the first-use consent.
- **Laura and Larissa:** Laura's spec-pass is done and folded in. In the run, a Larissa-style audit and a Laura-style pre-squash pass before the final commit, with findings listed in the report; deferrals still need Chris.

Commands: `pnpm test`, `pnpm typecheck` and `pnpm run build`.

## 11. Documentation

- New ADR (next free number after 0037): OAuth for MCP is client-side, tokens sync as ciphertext, the claim model, and plaintext in transit through the proxy.
- `CLAUDE.md` §14: clarify that "No OAuth or third-party identity providers" means signing in **to Chatsundere**, and link the ADR.
- `superpowers/specs/2026-06-08-mcp-client-design.md`: note at D7 that this spec supersedes it.
- Help content for integrations; the `README.md` needs no new environment variable.

## 12. Follow-ups to log

In `obsidian/insights/follow-ups-index.md`:

- Backend relay for the sign-in code, removing copy and paste on separated windows. Trigger: the iPhone device test shows it is annoying.
- Per-tool "Allow always". Trigger: someone asks.
- MCP protocol `2026-07-28`. Trigger: a server forces it, or the next MCP client pass.
- A manual client ID field. Trigger: a real server needs it.

## 13. Manual verification

Chris runs these. Unattended runs cannot, because they involve real devices and accounts.

**Instance:** deploy the branch somewhere with a public HTTPS origin, otherwise servers cannot fetch the client metadata.

1. **Kumbu², PC browser:** create a connection in Kumbu² and paste its `/mcp/c/…` link. `Sign-in required`, confirmation names the host, sign-in in a window, the window closes or says to return, `● Connected`, tools listed. A tool call works.
2. **Plain `/mcp` of Kumbu²:** no sign-in offered; the key field appears; an API key works as before.
3. **Android, installed PWA:** repeat step 1 with a second connection. Note whether the window returns by itself or shows the code.
4. **iPhone, installed PWA:** repeat step 1 with a third connection. Note whether the code is needed, whether it is workable, and whether the 60 seconds are enough. Repeat with the PWA evicted during sign-in, so that it has to be unlocked first, which is the worst case. **This decides the relay follow-up.**
5. **macOS, browser and installed PWA:** repeat step 1 on one of them.
6. **Second device:** open a chat on a device that did not connect. `Use this server here?` names the host, once. The call runs.
7. **Rotation across devices:** wait for an access token to expire (one hour at Kumbu²) and use it on device A. Then use it on device B. Neither prompts. Kumbu²'s log shows one `issued` refresh and no reuse.
8. **Offline device:** take device B offline, rotate on device A, bring B back, and use the tool on B. It works; the Kumbu² connection is **not** revoked.
9. **Revoked server side:** revoke the connection in Kumbu². The next tool call shows the `sign-in ended` pill; the model reports the problem; no window opens. *Sign in again* opens the overlay over the chat, the draft survives, and asking again works.
10. **Backend down:** stop the proxy and sync with an expired token. Status reads `○ Waiting for your Chatsundere server`, the pill says it can't renew access and offers no sign-in; nothing is revoked after the backend returns.
11. **Notion and GitHub:** connect each. Either they work, or the refusal is understandable and *Use a key instead* is available. A raw error on the server's own page is out of our hands; check that the waiting screen's way out makes sense beside it. Record the outcome.
12. **Remove server:** the confirmation says all devices. The server disappears on the other device, and Kumbu² shows the tokens revoked.
13. **Approval prompt:** on a non-auto-run server the prompt shows the host, the arguments and Always allow; the latter stops prompting for the whole server. On a second device there is one prompt per call, not two.
14. **Local-only device:** without a linked server, the Kumbu² link shows "Couldn't reach this server directly…" with the pointer to linking.
15. **Leaving the flow:** on the iPhone, tap back while waiting, get the code, and return through `○ Sign-in in progress`. Deny at the server, and check the message. A server that is down can be saved through *Enter details manually*.
16. **Self-hosting check:** fetch `/oauth/client-metadata.json` on the instance. `client_id` equals the exact URL fetched.
