# Chatsundere Status — Client-only

> **Resuming after a `/clear` (2026-05-30)?** Read the warm handoff first:
> [[insights/2026-05-30-handoff-to-next-session]].

> **Roadmap to beta locked (2026-05-31):** [[ROADMAP]] / [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md). Client-only work is **Blocks 1-5 → v0.1.0/v0.2.0**. Block 1 (chat core) is ~80% shipped; **memory** (chatsune port) is the notable gap. Block-1/Block-2 design notes: [[insights/2026-05-31-roadmap-lock-block1-block2-design-notes]].

**Last updated:** 2026-06-04 — **Pinned-cockpit interaction tweaks landed (on
master `2dcb6c3`, NOT pushed; device-tested by Chris — both work great).** Two
client-only UI behaviour changes (plus one follow-on), conversational (no
spec/plan, no Larissa path). The mental model Chris settled on: a **pinned**
cockpit means the user is set on *full interaction*; **unpinned** is the
read-heavy *zen mode*. (1) **Logo works as a back-to-Entrance-Hall button while
unpinned.** The brand logo was already a `<Link to="/">`, but the unpinned
outside-tap close-handler (`InteractionMode.tsx`) swallowed its click; the
handler now exempts `.brand-logo` so the Link navigates (`/` → Gate → `/app`).
Pinned already worked (the close-listener early-returns while pinned). (2) **No
dimming on input focus while pinned.** `DimOverlay active={... && !isPinned}`
(`chat-page.tsx`) — the chat stays bright in full-interaction mode; the
zen-mode dim on focus is unchanged while unpinned. (3) **Send-while-pinned now
keeps input focus** (Chris's call): `handleSend` no longer blurs the textarea
when pinned, so the keyboard stays up for continued typing — the reply streams
undimmed via (2) rather than the old focus-shed workaround. Verification:
`interaction-mode.test.tsx` 10/10 (rewrote the old 'releases focus' test →
'keeps focus', added a logo-exemption test); `pnpm typecheck` 13/13; biome
clean; the lone `chat-page.test.tsx` fail is the unchanged `localStorage`-jsdom
baseline (verified identical on master). **Next:** Liz pushes the master backlog
when Chris says; then memory (the long-weekend item).

**Earlier 2026-06-03 (evening) — Ollama Cloud is now a web backend
(search + fetch), and the web-backend default is first-come with fallback.** On
master, NOT yet pushed (the earlier round below was pushed). Two pieces, spec +
plan in `superpowers/{specs,plans}/2026-06-03-ollama-web-and-first-come-default*`:
**(A) Ollama web** — a new `ollama-web` adapter (`web-adapters/ollama-web.ts`,
mirrors nano-gpt-web) hitting `ollama.com/api/web_search` + `/api/web_fetch`
(Bearer, same `ollama-cloud` key as LLM), routed through the CORS proxy. Two
catalogue offerings: `web-ollama-search` (traits `ai`, tiers standard 5 / quick 3
/ deep 10) and `web-ollama-fetch`. Live-verified **4/4** via
`run-ollama-web-suite.ts` (5/3/10 hits prove the `max_results` mapping; fetch 940
chars). **(B) First-come default** — usable providers are now ordered by
`createdAt`, so the first-configured web provider is the default per role; and
`resolveWebBackend` falls back to the next-best when an explicit pick's
key/provider is deleted, instead of going dark. No active key-event mechanism —
the live per-message resolution handles it; the stored pick reactivates if its key
returns. Record: [[providers/ollama-cloud]] (Web interfacing section). **Next:**
squash into 2 feature units + doc, then Chris device-tests the §6 steps (ollama-
first vs nano-gpt-first defaults, delete-active-key fallback, a real search+fetch
in chat); Liz pushes on Chris's word.

**Earlier 2026-06-03 (afternoon) — Web interfacing device-tested + hardened;
ollama-cloud onboarded for web search (pushed).** A long feedback round after the
landing. **(1) Web-settings UI** (`d07fb89`, `9445623`): the raw section is now an
`AccordionCard` like the others; the search picker lists only search backends
(Linkup default/Exa/Brave) and fetch only nano-gpt, with friendly "Engine
(provider)" names and a concrete pre-selected default (no abstract "Default"
entry); a styling pass (dark custom-chevron selects, marker-pill traits, ZK note).
**(2) ollama-cloud onboarded for web search** — a deep, four-layer debug
(Chris's instinct to check chatsune was the key). The generic adapter path was
incomplete: it never sent `tools` (`a4bc53d`) nor `stream_options`/usage
(`a39579c`) — both fixed for *any* generic OpenAI-compatible provider. The real
fix is a **native ollama `/api/chat` (NDJSON) adapter** (`d9af9a6`): ollama's
OpenAI-compat `/v1` shim makes reasoning-native models **re-call the tool instead
of answering** after a tool result; the native endpoint answers (chatsune's path).
The adapter framework gained two general hooks — **`WireRequest.path` +
`ModelAdapter.responseFraming` (`'sse' | 'ndjson'`)** + `parseWithAdapterNdjson` —
so any non-OpenAI provider can now plug in. ollama-cloud = `glm-5.1` +
`deepseek-v4-pro` (both fixed-on, verified catalogue; dead slugs + non-reasoning
gemma dropped). **(3) web_search prompt nudge** (`3d66435`): glm-5.1 searched
endlessly (its nature); a restrictive description + "search on request, two or
three are plenty, then answer" (chatsune pattern + Chris's idea) makes it settle —
**model-wide** improvement. Live-verified end-to-end through the real client path:
glm answers in round 1, deepseek by round 4. **Lesson (worth keeping):** the
conversation-suite validates the *pipe* (a tool *fires*), NOT the *loop* (the
model *answers* after the tool result) — that gap let both the `/v1` re-search and
glm's churn pass green; verify multi-turn tool-loop behaviour on device, or extend
the suite with a post-tool-answer assertion (noted in
[[providers/ollama-cloud]]). Records: [[providers/ollama-cloud]],
[[feedback_verify_tool_loop_answers_not_just_fires]]. **Next:** Liz pushes the
master backlog (now 10 ahead) when Chris says; then memory (the long-weekend item).

**Earlier 2026-06-03 — Web interfacing live via nano-gpt (squashed on
master `1bf5462`, NOT pushed; awaiting Chris's device test — his VPS CORS proxy
is up + already tested, so it should work immediately).** The dormant spine is
now wired end-to-end: a nano-gpt **search** adapter (`/api/web` — Linkup/Exa/
Brave) + **fetch** adapter (`/scrape-urls`), both reusing the `buildRequest`
transport primitive; **three curated `web` search offerings** (Linkup default,
Exa, Brave; Kagi deferred — empirically the *priciest*, not the cheapest) + a
scrape fetch offering. `WebOfferingMeta` gained `traits`/`requiresProxy`/
`searchTiers` (dropping `qualityClass`; `ai-friendly` folded into an `ai` trait).
**CORS is the load-bearing finding:** the web endpoints send no CORS headers
(chat does), so web search/fetch **must route through the user's CORS proxy**
(the `requires-proxy` rail) — modelled as data on the offering, decoupled from
nano-gpt's chat `corsHint: inofficial`. The web tools are **gated on a configured
proxy**: without one, the settings section shows a "needs a proxy" notice
(disabled-over-hidden) and no tool is offered. **Auto-default Linkup** (unset →
recommended; explicit Off available) so web-search *availability* isn't gatekept
to power users; **search depth** is a per-message cockpit control (Exa Quick/
Neural, Linkup Standard/Deep) curated per offering, user-set, cheapest-default.
Proxy + selected tier are threaded through the shared send path; settings carry
trait badges + a **zero-knowledge note** ("queries leave your device"). Built
subagent-driven (14 TDD tasks, serial + per-task spec/quality review + a final
**opus** holistic review that caught a real Critical — the UI advertised an
auto-on web search that silently no-opped without a proxy; fixed before squash).
**Live conversation-suite** (`run-web-suite.ts`, direct-routing in Bun) **6/6**:
every curated tier verified live (Exa `numResults:8` + `neural` honoured). **Not
a Larissa change** (llm-unified + user-client; no auth/sync/proxy/crypto); the
realised outbound surface logged in [[insights/security-deferrals]]. Verification
(on master after the squash): `pnpm typecheck` **13/13**; llm-unified `bun test`
**260/0**; user-client vitest **802 pass / 8 fail** (the unchanged `cockpit-draft`/
`chat-page`/`chat-route` localStorage-jsdom baseline); build **9/9**. Spec/plan:
[[../superpowers/specs/2026-06-03-web-interfacing-nano-gpt-adapter-design]],
[[../superpowers/plans/2026-06-03-web-interfacing-nano-gpt-adapter]]. **Note:** the
first squash captured only Tasks 1–7 (a stale worktree branch-ref via `git -C`);
recovered by squashing the dangling branch-tip tree, re-verified on master before
commit. **Next:** Chris device-tests web search/fetch end-to-end (proxy is up) →
Liz pushes the master backlog; then memory (the long-weekend item).

**Earlier 2026-06-02 — Web-interfacing integration spine
landed (merged to master via PR #1 `7fd4692`, NOT pushed; Chris to device-test
+ integrate).** Implemented from the Liz/Lyra
spec end-to-end, strict TDD per task. The dormant *integration spine* — a
first-class `Integration` abstraction (the counterpart to `Tool`) — with web
interfacing (`web_search` + `web_fetch`) as its first case, wired and gated but
provider-less; the only work left to go live is the nano-gpt web adapter +
curating the `web` offerings. **What landed:** (1) **llm-unified** type
contracts (`WebContext`/`WebLocation`/`WebSearchResult`/`WebFetchResult`/
`WebQualityClass`/`WebOfferingMeta`/`WebInterfacingProvider`), an optional
`Offering.web` metadata block, and a `web-adapter-registry` (empty today →
nothing resolves → dormant). (2) **user-client** `Integration`/
`IntegrationContext`/`OfferingRef` types; the `WebInterfacing` integration
(`integrations/web/`) owning both tools, contributing each only when a selected
`web` offering's `canSearch`/`canFetch` **and** a resolved adapter agree; an
`INTEGRATIONS` array. (3) The **tool registry** evolved from a static list to
`resolveActiveTools(ctx)` = static (`calculate_js`) + active-integration tools;
`toolDefs`/`systemPromptSegment`/`dispatch` are now pure over an explicit
`Tool[]`. (4) **Dexie v11**: `SettingsRow.webInterfacing = { search, fetch }`,
migration backfill + seed default `{ null, null }` (existing fresh-open verno
assertions bumped 10→11). (5) `buildIntegrationContext(persona, web, mk)` per
send (NSFW from `adultPersona`; location deferred → null; credential-bus
`getKey`, MasterKey-gated, call-time only); the **stream-manager** builds it and
threads the ctx-bound active tools into the existing tool-loop seam (loop logic
unchanged); `send-message` threads `webInterfacing` from settings into
`start`/`regenerate`. (6) A functional **unstyled** `WebInterfacingSection` in
My Settings (two independent pickers, disabled-over-hidden *within*), gated
**hidden-until-unlocked** on the `web` modality — invisible today because no
`web` offering is curated. **Dormant + zero-regression:** at zero `web`
offerings the model is offered only `calculate_js`, exactly as before. **Not a
Larissa change** (client-only, no auth/sync/proxy/crypto); the *planned*
outbound surface for the future adapter is recorded in
[[insights/security-deferrals]]. **Deferred by design:** the nano-gpt adapter
(next), the `WebLocation` *source* (shape threaded, flows `null`), the opulent
styling pass. **One design fix during verification:** the default integration
now references the live catalogue/registry resolvers *lazily* (arrow-wrapped) so
unrelated tests that partially mock `@chatsundere/llm-unified` and merely import
the integration chain don't trip on missing exports at module load.
Verification: `pnpm typecheck` **13/13**; llm-unified `bun test` **248 pass / 1
fail** (the pre-existing `canonical-registry` double-registration ordering flake
— passes in isolation, identical on master); `pnpm run build` **9/9**;
user-client vitest **764 pass / 0 fail** (fully green — the previously-noted
`cockpit`/`chat` jsdom flakes did not manifest in a clean-container build).
Spec/plan:
[[../superpowers/specs/2026-06-02-web-interfacing-integration-spine-design]],
[[../superpowers/plans/2026-06-02-web-interfacing-integration-spine]]. **Next:**
the **nano-gpt web adapter** — write it, register it in the
`web-adapter-registry`, curate the `web` offerings (brave/exa/linkup, each its
own offering); the section then auto-appears and web search/fetch go live. Then
memory (the long-weekend item).

**Earlier 2026-06-02 — Frontend polish round (5 items)
landed (squashed on master `fd30cb5`, NOT pushed; items 1-4 device-tested by
Chris, item 5 awaiting his device test).** A second "frontend-improvement"
pass, built conversationally with Chris (no spec/plan, no Larissa path — UI
only). **(1) Per-token fade restored.** The rich-Markdown renderer had silently
dropped it (it re-parses the whole text per token). Now a streaming-draft text
group renders each *un-coalesced* chunk (`stream-manager.appendStreamChunk`
deliberately doesn't merge) as its own `.stream-tok` span — a freshly-mounted
span fades in (`@keyframes tok-fade`, 420ms, reduced-motion off), so the reply
materialises token-by-token as **raw text**; on finalise the blocks coalesce
and re-render once via `MarkdownContent`. No stream-engine/stream-manager change
(kept off claude-web's parallel web-tools spine). **(2) Dim-overlay un-dim now
fades.** It faded on dim (200ms) but the chat-page-conditional `InteractionMode`
unmounted on close, so the dark layer vanished instantly. `DimOverlay` lifted to
a permanent `.chat-page` child driven by `current-chat.store` `inputFocused`
(`active={isInteractionMode && inputFocused}`); `InteractionMode` only drives the
flag now, so the overlay outlives the unmount and the opacity transition runs
both ways. **(3) Model-emitted Markdown images — privacy fix.** The renderer
turned `![](url)` into a bare `<img>` the browser auto-fetched → IP/timing leak
to a third party (a tracking/exfiltration vector, contradicts zero-knowledge).
New `markdown/ImageMarker.tsx` (the `img` override) renders a tap-to-load pill
naming the source host; loads only on consent with `referrer-policy:
no-referrer`, never persisted. A **scheme allowlist** (only `http(s)` +
`data:image/` are loadable) sends unsafe schemes
(`javascript:`/`file:`/`blob:`/non-image `data:`/relative) to an inert,
non-clickable marker — a background security review flagged the error-state
recovery link as a `javascript:`-URL XSS vector; hardened (allowlist + the link
only rendered for http(s)) and folded into the squash before finalising.
Constructive error on failure. Phase-2 follow-up logged: route the consented load
through `proxy-service` (no IP leak even then). **(4) Adult-mode pill hides in
SFW chats.** `chat-page` publishes `chatPersonaIsAdult` to the store; the
brand-bar `AdultModeToggle` renders `null` when `=== false` (chat + SFW persona)
for a calmer screen — visible otherwise (`null` outside chats, `true` for adult
personas). **(5) Brand-bar chrome trimmed inside a chat.** `root.tsx` derives
`isChatRoute`/`isReadingChat`/`isLoginRoute`: username + connectivity ("LOCAL")
drop in **both** chat sub-modes; reading mode **also** drops the "Chatsundere"
logo and compacts the bar (`py-1`/`lg:py-1.5`) while
`.chat-page[data-mode="reading"]` pulls `top` 3.5rem→2rem (mobile) /
4rem→2.25rem (desktop) with a 180ms transition — the chat surface rises into the
reclaimed space; the adult pill moved to the right cluster (off-centre, away from
device cameras) and is suppressed on `/login`. **Tuning knobs (Chris, on
device):** header `py-1`/`lg:py-1.5` + the reading `top` values. **Pre-existing
biome fix folded in:** the `.pill-detail*` one-liner from the `calculate_js` work
was reformatted so the lefthook staged-files check passed. **Not a Larissa
change** (no auth/sync/proxy/crypto). Verification: `pnpm typecheck` **13/13**;
user-client vitest **755 pass / 8 fail** (the unchanged
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline, verified
identical on master); build **9/9**; biome clean on all touched files. New tests:
`image-marker` (7, incl. the unsafe-scheme refusal), `root.chat-chrome` (5) +
`message-block`/`interaction-mode`/
`current-chat-store`/`AdultModeToggle` updates. **Next:** Chris device-tests
item 5 (top-bar) → Liz pushes the master backlog; then `web_search`/`web_fetch`
(the larger nano-gpt integration) and memory (the long-weekend item).

**Earlier 2026-06-02 — Tool-execution spine +
`calculate_js` landed (squashed on master `ec3515f`, NOT pushed; awaiting
Chris's device test).** Brainstormed end-to-end with Chris, built
subagent-driven in an isolated worktree (12 tasks, serial implementers +
per-task review + a final **opus** holistic review = READY TO SQUASH). The
first of the planned "three tools"; `web_search`/`web_fetch` are a separate,
larger nano-gpt **integration** axis (0..n keyed by the user's API keys),
deliberately out of scope here. **What landed:** the missing *head and tail*
of tool support — the wire layer was already tool-ready, but tool defs were
never sent and a streamed tool-call became an inert `completed` pill that was
never executed. Now: (1) an **always-on class-based tool registry**
(`apps/user-client/src/tools/`) — each `Tool` carries its wire `ToolDef`, an
optional `systemPromptInstruction: string | null`, and an `execute`; helpers
`toolDefs()` / `systemPromptSegment()` / `dispatch()`. **No tool toggle**
(omakase + curation — any model that misbehaves with reasoning+tools is a
curation exclusion, not a feature). (2) **`calculate_js`** runs in a **fresh
Web Worker per call** (dangerous globals nulled on `self` + function-locally,
**4 KB** output cap, **10 s** timeout, terminated on success/timeout/abort);
the contract returns captured `console.*` **plus the completion value of the
final expression** (direct `eval` inside a `new Function` scope — kills
chatsune's empty-output trap). (3) The **tool-execution loop**
(`lib/tool-loop.ts`, pure + injected deps): inject defs → detect tool-call
pills → `dispatch` → append `assistant(tool_calls)` + `tool` messages →
re-stream; **capped at `MAX_TOOL_ROUNDS = 5` tool rounds** (counted globally
across all future tools — Chris's Gardasee example), then a forced tools-less
answer. (4) `stream-engine` gained `tools`/`toolExchange`/`toolsInstruction`
(pills now default `pending`); `stream-manager` binds the loop (gated on
`offering.profile.toolCalls.supported`) and **mirrors live pill status**
(`pending→completed/failed`) into the streaming draft via `onPillUpdate` +
`ChatStream` pill-buffer merge. (5) **Band-3 tools segment** in the prompt
builder (chat-only) — finally a producer for the reserved slot. (6) **Pill is
tap-to-expand** showing the executed code + result/error. **Persistence
boundary (deliberate):** the result is persisted in the pill payload, but
cross-turn replay of the tool exchange to the model stays **deferred** (like
chatsune) — the final answer text carries the result. **Not a Larissa change**
(no auth/sync/proxy/crypto); the JS-eval sandbox is logged in
[[insights/security-deferrals]]. **Process note worth keeping:** the full
vitest run (Task 11) caught a regression the per-task reviewers missed — they
ran typecheck + the touched test dir, not the full suite. The store now reads
`args.offering.profile`, which broke `stream-manager-store.test.ts`: its stub
used a **stale `model` key** (pre-catalogue-migration) instead of `offering`,
masked for ages by an `as never` cast because the store never read the
offering directly. Reinforces [[feedback_per_task_review_runs_full_suite]] —
per-task verification must run the **full** vitest. Verification: `pnpm
typecheck` **13/13**; llm-unified `bun test` **251/0**; user-client vitest
**738 pass / 8 fail** (the unchanged pre-existing `cockpit-draft`/`chat-page`/
`chat-route` localStorage-jsdom baseline, confirmed identical on master);
build **9/9** (`sandbox.worker.ts` emitted as its own chunk). Spec/plan:
[[../superpowers/specs/2026-06-02-calculate-js-tool-spine-design]],
[[../superpowers/plans/2026-06-02-calculate-js-tool-spine]]. **Next:** Chris
device-tests the 6 manual steps (spec §11 — the strawberry question returns 3
via an expandable pill; a provoked sandbox error recovers; a maths-free chat
is unchanged); then `web_search`/`web_fetch` as the larger nano-gpt
integration, and memory (the long-weekend item).

**Earlier 2026-06-02 — Frontend smoothness round landed
(squashed on master `8ef3501`, NOT pushed; awaiting Chris's device test).**
An "inserted frontend-improvement day" (next up is memory, which Chris is still
thinking through — slated for the long weekend). Five client-only polish items,
built conversationally (no spec/plan, no Larissa path — UI only). (1)
**Focus-led pinned cockpit**: sending while pinned now *releases* input focus
→ the user drops back into reading mode (`DimOverlay` off via blur in
`InteractionMode.handleSend`) so the streamed reply is bright/legible rather
than dimmed behind a held focus. (2) **"Shed focus, then activate"**: while
pinned + composing, the first tap on a message only sheds the input focus
(detected at `onPointerDownCapture` while `.cockpit-input` is still
`document.activeElement`, in `MessageBlock`; `isPinned` threaded via
`ChatStream`); a second tap activates it — nothing snatched in one gesture.
(3) **Top-bar redesign** (`InteractionTopbar` + `index.css`): persona avatar
28→36px and wrapped in a `.topbar-avatar-btn` that is now the tap target into
persona settings (name kept in `aria-label`); persona name removed; a
`.topbar-project` slot takes its place (display font + persona accent inline),
showing a muted italic "(no project)" placeholder (`data-empty`) until projects
are modelled — new optional `projectName` prop, no data source yet; bar
tightened (vertical padding 0.5→0.25rem) and `.topbar-left` made a flex row so
the avatar sits *beside* the hamburger (it was a missing rule — the
`display:flex` hamburger had been pushing the avatar onto its own line).
(4) **Avatar-editor preview crop bug fixed**: the pending preview rendered
`bg-cover` (whole, uncropped image) until a reload; it now reproduces the
confirmed crop via `cropToBackground(...)` exactly as the saved `PersonaAvatar`
does. (5) **Login focus after intro**: the passphrase field claims focus once
the cold-start intro finishes — on `splash-flip-done` (~2s) **or** the new
`chatsundere:splash-dismissed` event (added to `SplashOverlay`'s dismiss paths
for the reduced-motion / skip cases), whichever first; immediately on a warm
reload (`splashShown` already set). `PassphraseField` gained an optional
`inputRef`. Also: British-English'd the `DualActionBtn` streaming tooltip
("antwortet noch…" → "is still replying…") + its test; `.gitignore` ignores the
local `visuals/` scratch dir (Chris's mockup lives there). **Watch on device:**
(a) iOS Safari may place the caret without raising the on-screen keyboard for a
programmatic focus outside a user gesture — desktop/Android-Chrome are fine;
(b) when a **passkey** is the primary unlock, focus still lands in the
(secondary) passphrase field — deliberate per Chris's literal ask, revisit if
the keyboard-over-biometric feels off; (c) top-bar avatar size (`size={36}`)
and bar padding are the two tuning knobs. Verification: `pnpm typecheck`
**13/13**; user-client vitest **710 pass / 8 fail** (the unchanged pre-existing
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline, confirmed
identical on master); build clean. **Next:** Chris device-tests; then a new
session for **three tools** — a frontend feature set he says will lift
Chatsundere to a new level (memory deferred to the long weekend).

**Earlier 2026-06-02 — Persona settings landed
(squashed + merged to master `4093985`, NOT pushed; awaiting Chris's device
test).** Brainstormed end-to-end with Chris (the "deredere" full-pamper pass),
built subagent-driven in an isolated worktree (16 plan tasks, serial implementers
+ per-unit spec/quality review + a final **opus** holistic review). Three
client-only features, no Larissa path. (1) **Per-persona context window**:
`PersonaRow.contextWindow` + pure helpers (`resolveContextWindow` /
`truncateToWindow` / `outOfWindowCount` in `lib/context-window.ts`; **64k floor**,
4096 step). First **real history truncation** in `stream-engine.ts` (system prompt
+ active user turn always kept, oldest dropped until ≤ budget — chosen over
gauge-only); the context gauge now reads the resolved per-persona window
(`InteractionMode`); a quiet in-stream **`ContextMemoryMarker`** shows when earlier
messages leave the model's memory (the *dere* half — placed by `ChatStream` from
budget + systemTokens derived in `chat-page`; an honest approximation, not the exact
wire trim); editor **slider** green→recommended / red→max with **Use default**,
disabled when a model has no head-room. (2) **Persona avatar** — local-first /
zero-knowledge (deliberate divergence from chatsune's server-side store): **Dexie
v10** `personaAvatars` table holds the downscaled **full** image (512px WebP) **+
crop `{x,y,zoom}`**, rendered via **CSS** so the crop stays **re-editable**.
Rounded-square (matches the tiles) CSS pan/zoom **crop modal**, `<PersonaAvatar>`
with **monogram fallback** in My-Circle cards + chat top-bar, picked/cropped in the
editor and flushed on save; cascade-deleted with the persona. (3) **Substitute
vision model** — Chris's idea re-scoped **global** (was per-persona in chatsune);
this cycle ships only the **disabled, honest placeholder** in My Settings (no DB,
no picker) — the real upload/routing waits on the image-attachment subsystem (its
own spec). Decisions (Chris's): real truncation now; green/red slider; 64k floor;
avatar on cards + top-bar; rounded-square; full-image + CSS crop; global vision
substitute as a dormant shell. **Process notes worth keeping:** my plan shipped a
`truncateToWindow` off-by-one (test wanted `trimmed=1` but that left the result
**over** budget) — caught at the **first** review and corrected to drop-until-≤-budget.
The **full** vitest run (not just touched dirs) caught 13 regressions the per-unit
runs missed: verno assertions 9→10 after the v10 bump, and `interaction-mode.test`
needing a `QueryClientProvider` (the top-bar now renders `PersonaAvatar`→`useQuery`).
The opus review found + I fixed an object-URL leak in the editor's `AvatarField`.
Verification: `pnpm typecheck` **13/13**; user-client vitest **701 pass / 8 fail**
(the unchanged `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline);
build clean. Spec/plan: [[../superpowers/specs/2026-06-02-persona-settings-design]],
[[../superpowers/plans/2026-06-02-persona-settings]]. **Deferred:** the whole
image-attachment subsystem (upload/paste/drag-drop, attachment storage, a message
image block, multimodal wire injection, thumbnails) + Feature 3's real behaviour;
a per-model tokeniser (truncation keeps the 4-chars heuristic). **Next:** Chris
device-tests the 6 manual steps (spec §9); bug-hunting happens on master.

**Earlier 2026-06-02 — xAI / Grok 4.3 onboarded
(squashed + merged to master `b055e85`, NOT pushed; awaiting Chris's device
test).** Brainstormed end-to-end with Chris, built
subagent-driven in an isolated worktree. New curated provider **`xai`** with one
first-class model **Grok 4.3** (reasoning + **vision** + tools) over
`/chat/completions`. **Live-probed first (empirical truth over docs):** the
encrypted/summarised-reasoning machinery the xAI docs describe is **Responses-API
only**; on chat-completions Grok streams `delta.reasoning_content` that is
**already a readable summary** (270 reasoning-tokens → a one-sentence trace), with
**no opaque encrypted blob** — so reasoning is display-only (`replayReasoning:
false`; Chris's "encrypted-only replay" decision resolves to *no* replay, no blob
exists). Reasoning control is **`steps`** low/medium/high + off (default low,
default-on); `none` is a **clean off** (live-confirmed — not the wafer/Kimi
`fixed-on` leak). The one cross-cutting addition is **conversation-affinity
caching**: a new optional `CanonicalRequest.cacheKey` threaded
stream-engine(`args.chat.id`) → `streamCompletion` → `buildWire` → the adapter,
emitted as the **`x-grok-conv-id`** header only when present (one-shot path
deliberately omits it). Context **recommended 200k / max 1M** (above 200k xAI
~doubles the price → "compact and continue"); `corsHint: requires-proxy` (no CORS
headers); freedom-oriented model + deployment (🕊️), US jurisdiction, **no
TEE/ZDR today** (future NGO-negotiated ZDR is a venice.ai-style possibility —
[[insights/...]]/Records note it). Adapter mirrors `wafer-openai.ts`; client
wired via `built-in-providers.ts` + `ProviderSheet`. **No new `StreamChunk`
variant, no Dexie migration, no new persistence** — only the additive `cacheKey`.
**Not a Larissa change** (llm-unified + client only). **Live conversation-suite
PASS** (`run-xai-suite.ts`, the curation gate): core **44/44** + vision **4/4**,
0 fail — flips the offering to `confidence: 'verified'`. Verification: `pnpm
typecheck` **13/13**; llm-unified `bun test` **248/0**; build **9/9**;
user-client vitest **673 pass / 8 fail** (the unchanged pre-existing
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline). Spec/plan:
[[../superpowers/specs/2026-06-02-xai-grok-integration-design]],
[[../superpowers/plans/2026-06-02-xai-grok-integration]]. Records:
[[providers/xai]], [[models/grok-4.3]]. **Next:** Chris device-tests the 6 manual
steps (spec §9) → Liz pushes the backlog.

**Earlier 2026-06-02 — System-prompt builder v2 landed
(squashed on master `c581a61`, NOT pushed; awaiting Chris's device test).**
Brainstormed end-to-end with Chris. The fixed five-layer `composeSystemPrompt`
is replaced by a banded, ordered **segment builder** `buildPrompt(inputs, job)`
(`packages/llm-unified/src/composition.ts`): ten segments across **three bands**
— Band 1 Behaviour & Voice (tonality → NSFW → global → persona) in **all** jobs;
Band 2 Context & Knowledge (about-me → project → memories) **chat-only**; Band 3
Technical reserved with **no producer** this cycle — resolved, job-filtered,
empty-dropped, sorted by (band, order), joined with blank lines. Two curated,
**non-editable** "Chatsundere identity" constants (`src/identity/chatsundere-identity.ts`):
**Tonality** (anti-censorship voice; **default ON** per persona) and **NSFW**
(explicit unlock; **default OFF**, driven by the existing `adultPersona` flag).
Decisions (Chris's): (1) segment model with **only real producers** implemented,
the rest reserved slots; (2) **3-band order**, generic→specific; (3) tonality on /
NSFW off by default; (4) NSFW reuses the **one** `adultPersona` flag (visibility +
prompt). Because Band 1 runs in every job, an adult persona's NSFW segment now
reaches **title-gen + memory** by construction — and the old *unconditional* NSFW
line that `title-generator.ts` wrongly applied to SFW personas is **gone** (the
mitigated bug). The "unlocker" settings field → **`globalInstructions`** (Dexie
**v9** migration copies the value + backfills `chatsundereTonality=true`). All
three prompt sites — chat (`stream-engine.ts`), title (`title-generator.ts`),
**context-gauge** (`chat-page.tsx`) — derive inputs identically incl. the
about-me-override resolution (the final holistic review caught a gauge divergence
where `chat-page` ignored `aboutMeOverride`; fixed pre-squash). Built
**subagent-driven** (9 TDD tasks, serial, on `feat/system-prompt-builder`,
squashed) + spec-review + quality-review per task + a final holistic **opus**
review (**READY TO SQUASH**, no critical/important). **Not a Larissa change** —
`llm-unified` + client only, no auth/sync/proxy/crypto. Verification: `pnpm
typecheck` **13/13**; llm-unified `bun test` **237/0**; user-client vitest **671
pass / 8 fail** (the unchanged `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline, **verified identical on master**); build **9/9**.
Spec/plan: [[../superpowers/specs/2026-06-01-system-prompt-builder-design]],
[[../superpowers/plans/2026-06-01-system-prompt-builder]]. **Deferred** (spec §9):
the final identity-text wording pass (initial British-English drafts shipped);
producers for project/memories/formatting/tools/TTS slots. **Next:** Chris
device-tests the 6 manual steps (spec §10), then pushes the master backlog (now 8
ahead of origin).

**Earlier 2026-06-01 — Session branching landed
(squashed on master `f1463d2`, NOT pushed; awaiting Chris's device test).**
Block-1 chat-core feature, brainstormed end-to-end with Chris. The per-message
`✎ Branch` control (previously a disabled "arrives later" stub) now forks a chat
at any message into a **new, fully independent session**: a bottom-sheet collects
a **mandatory** name, then `useBranchChat` copies the chat plus every message and
pill **up to and including** the branch point with fresh ids — the load-bearing
step is **rewriting the `pillId` references inside the copied `contentBlocks`** so
they point at the new pills (the easy-to-miss correctness trap). Persona and
mindspace are **referenced, not duplicated**; `draftInput` is reset;
`createdAt` preserved while `lastMessageAt`/`bookmarkedMessageCount` are
recomputed for the branch. Decisions (Chris's): (1) **inclusive** cut; (2) button
**locked while a stream is live** (`branchDisabled = isStreamLive`, "disabled over
hidden" with tooltip); (3) name **mandatory** (confirm disabled when empty); (4)
an **incomplete** branch-point message is copied **verbatim** (not normalised) —
pinned by a test. On a failed branch (race: branch point deleted) the sheet
**stays open with the typed name + a constructive error** (spec §7, the *dere*
half) — this gap was caught by the final holistic review and fixed before merge.
Built subagent-driven (4 TDD tasks, serial, on `feat/session-branching`, squashed)
+ spec-review + code-quality review per task + a final holistic review. **Not a
Larissa change** — client-only, no auth/sync/proxy/crypto. Verification: `pnpm
typecheck` clean; user-client vitest **666 pass / 8 fail** (the unchanged
pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline,
identical on master); build **9/9**. Spec/plan:
[[../superpowers/specs/2026-06-01-session-branching-design]],
[[../superpowers/plans/2026-06-01-session-branching]]. **Next:** Chris
device-tests the 7 manual-verification steps (spec §9), then pushes the master
backlog.

**Earlier 2026-06-01 — Rich message rendering landed
(squashed on master `433cd79`, NOT pushed; awaiting Chris's device test).**
Block-1 chat-core feature, brainstormed end-to-end with Chris, achieving parity
with chatsune's renderer. Chat message text now renders as full **Markdown + GFM
+ KaTeX maths + shiki-highlighted code + mermaid diagrams** (previously verbatim
`pre-wrap` text, zero formatting). Architecture: Markdown renders **only over
`text` ContentBlocks**; `pill`/`reasoning` blocks stay untouched React
components — chatsune's inline-pill rehype plugins were deliberately **not**
ported (our structured-block model supersedes them). The crown jewel is the
ported **`preprocessMath()`** LaTeX-compatibility layer (`\(..\)`/`\[..\]`
normalisation, code-masking so maths inside code survives, multiline display
fences, `\\[Npt]` guard) carried over with chatsune's 45-case diagnostic suite.
`shiki` (~18 langs) and `mermaid` load **lazily** (dynamic import — not in the
initial bundle). Decisions (Chris's): (1) **live Markdown during streaming**
(re-parse per token, memoised on `MarkdownContent`) — the per-token fade-in is
replaced by the whole-bubble entrance animation; (2) **full parity** scope incl.
mermaid; (3) **both user and persona messages render Markdown** — a deliberate
divergence from chatsune (which keeps user bubbles plain); consequence:
user-typed single newlines collapse and `# ` becomes a heading (see
[[project_user_and_persona_both_markdown]]). `.msg-text` lost its verbatim
`pre-wrap` in favour of opulent Aurora markdown styling: ink-soft code
surfaces with a single restrained aurora glow, `--font-display` (serif)
headings, accent-lilac links, marker-pill inline code, KaTeX display blocks
(opulent styling pass applied 2026-06-01). Built
subagent-driven (10 TDD tasks, serial, on `feat/message-rendering`, squashed) +
spec-review per task + a final holistic **opus review** that caught the
`pre-wrap` double-spacing blocker (fixed before merge). **Not a Larissa
change** — client-only, no auth/sync/proxy/crypto. Verification: `pnpm
typecheck` clean; user-client vitest **657 pass / 8 fail** (the unchanged
pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom
baseline); build clean with shiki/mermaid as lazy chunks. Spec/plan:
[[../superpowers/specs/2026-06-01-message-rendering-design]],
[[../superpowers/plans/2026-06-01-message-rendering]]. Deferred follow-ups:
`MessageBlock` memo (streaming perf), main-chunk weight (katex synchronous) —
both in [[insights/follow-ups-index]]. **Next:** Chris device-tests the
manual-verification checklist (spec §Manual Verification), then pushes the
master backlog.

**Earlier 2026-06-01 — Bookmarks & table-of-contents landed
(squashed on master `51931d4`, NOT pushed; awaiting Chris's device test).**
Block-1 chat-core feature, brainstormed end-to-end with Chris. One unified model:
a message has a `bookmarked` flag (the **star** = global bookmark) and an optional
`bookmarkLabel` (default = text snippet). The per-chat **ToC is derived** —
`buildToc()` yields a *timeline* of every user message (ChatGPT-style auto-index)
plus a *pinned* section of all starred messages (user + persona; a starred user
message intentionally shows in both, keeping the timeline lossless). Two triggers,
one data op: the message-level `◈` (now wired — it was a no-op stub) and the ToC
star. Surfaces: a ghostly **reading-mode floating control** (`ReadingToolStrip`,
collapse-on-outside-interaction, pin to keep open — its own store state, *not* the
cockpit `isPinned`) opens a **`TocSheet`** overlay (pinned + timeline, inline
rename, star, tap-to-jump → lands in Reading Mode at the message with a highlight
pulse); a **`Chats | Bookmarks` segmented tab** in `/app/history` aggregates
starred messages grouped by chat, jumping cross-chat via `?focus=<messageId>`.
**No Dexie migration** (`bookmarkLabel` non-indexed). Design rationale (Chris):
**Reading Mode is the central surface** (chatting ≈ 80% reading / 20% typing), so
navigation lives there and jumps land there. Built subagent-driven (10 TDD tasks,
serial, on `feature/bookmarks-and-toc`, squashed) + final holistic review
**APPROVED** (no critical/important findings). **Not a Larissa change** —
client-only, no auth/sync/proxy/crypto. Verification: `pnpm typecheck` 13/13;
user-client vitest **592 pass / 8 fail** (the unchanged pre-existing
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline); build clean.
Spec/plan: [[../superpowers/specs/2026-06-01-bookmarks-and-toc-design]],
[[../superpowers/plans/2026-06-01-bookmarks-and-toc]]. **Next:** Chris device-tests
the 6 manual steps (spec §9), then pushes the master backlog; then Block-1 memory
(chatsune port) per [[ROADMAP]].

**Device-test polish (squashed `1c750eb`, NOT pushed)** — five device-found
issues fixed after the feature landed. Notable: the reading tool-strip was
invisible because `position:fixed` was trapped by the mindspace **transform**
layers' containing block (the hazard already documented for the bottom
affordance) — bound the strip + ToC sheet to `.chat-page` via `position:absolute`
instead. Also: jump now disables auto-follow so it lands on the target message
(not the chat end); pin active-state via background tint (emoji ignore `color`);
visible inline rename field; rename/remove on the global Bookmarks list;
reasoning UI refreshes on mid-chat model change (offering query keyed on
provider+model, not just persona id); full-width message-selection tint (no
inner inset box that narrowed text — Chris's "mobile-first = economical with
space" insight, see [[feedback_economical_with_space]]); and **My History** now
uses a custom themed persona dropdown (native `<select>` option lists can't match
the dark surface) plus title-search + persona-filter on the **Bookmarks** tab,
NSFW-aware.

**Earlier 2026-06-01 — Credential bus landed (squashed on
master `7ca7425`, NOT pushed).** A forward-looking client-side structure
(`apps/user-client/src/credentials/`) that answers "does the user have an API
key for credential X?" and, MasterKey-gated, returns it — anticipatory
scaffolding for future **integrations** (e.g. a nano-gpt usage/balance
surface), with no consumer yet. Four decisions (all Chris's): (1) **pass
through existing enabled provider keys** — no duplicate entry, no separate
store; (2) **abstract `CredentialId`** over a `CredentialSource` registry —
only `providerKeySource` today (`credentialId === templateId`), a
standalone-key/LAN-actuator source is the documented future extension; (3)
**query + reactive surface** — `hasCredential`/`getCredentialKey` (imperative)
plus a presence-only `useCredential` hook keyed `QK.credential(id)` under the
`providers` prefix, so provider mutations invalidate it for free; (4)
**enabled-gating** — presence is false for a disabled provider (conscious
coupling: disabling a chat route hides its integration; revisitable by dropping
the `enabled` filter). Presence is MasterKey-free; retrieval is MasterKey-gated
via `openSecret` on the same slot the chat path uses (`provider/<rowId>/api-key`);
the reactive hook **never exposes plaintext**. No new persistence, no Dexie
migration, no wiring into existing call sites — the bus only adds the surface.
Built subagent-driven (4 tasks, spec+quality review each + a final holistic
**READY-TO-MERGE** pass on a `feature/credential-bus` branch, then squashed).
15 unit tests; `pnpm typecheck` 13/13; full user-client vitest **561 pass / 8
fail** (the unchanged pre-existing `cockpit-draft`/`chat-page`/`chat-route`
localStorage-jsdom baseline). **Not a Larissa change** — it *uses* `secrets.ts`
but touches no crypto primitive and no auth-/sync-/proxy-service; logged in the
security journal as a new unsealed-key access surface (follow-up when the first
integration lands: retrieve keys only at the outbound-call point, never persist/
log plaintext). Spec/plan/ADR:
[[../superpowers/specs/2026-06-01-credential-bus-design]],
[[../superpowers/plans/2026-06-01-credential-bus]],
[ADR 0033](decisions/0033-credential-bus.md). **Next:** Chris pushes the master
backlog when ready (now 10 commits ahead of origin); then Block-1 memory
(chatsune port) per [[ROADMAP]].

**Earlier 2026-06-01 — Claude models live via nano-gpt
(squashed on master `153a926`, NOT pushed; awaiting Chris's device test).**
Seven Claude offerings (Haiku 4.5; Sonnet 4.5/4.6; Opus 4.5/4.6/4.7/4.8) — the
first `freedomOriented:false` models, surfaced with a **CENSORED** badge derived
from `effectiveFreedom='restricted'`. Delivered via **nano-gpt, not OpenRouter**
(OpenRouter's limited-keys path routes Anthropic to Amazon Bedrock → no
`cache_control`; ADR 0032). New deterministic **Anthropic cache-breakpoint
module** (stable-prefix 1h / token-anchored history anchor 1h / rolling tail 5m)
injected by a `claudeAdapter` wrapping the nano-gpt slug-swap adapter; reasoning
is a clean **toggle** (effort does not modulate — live-measured). Signature
replay deferred build-when-needed (no tool-loop consumer). Live-verified: all 7
**22/22 + cache engaged**. Spec/ADR/records:
[[../superpowers/specs/2026-06-01-premium-model-integration-design]],
[ADR 0032](decisions/0032-premium-censored-models-via-routers.md),
[[models/claude-4]], [[providers/nano-gpt]]. **Manual verification pending:** the
CENSORED badge in the picker + falling prompt cost on a multi-turn Claude chat.

**Earlier 2026-06-01 — Chat-UI smoothness polish round
(squashed on master, not yet pushed; device-verified by Chris).** Seven items,
all client-only (no Larissa path). (1) **Ctrl/Cmd+Enter sends** everywhere
(desktop + mobile); plain Enter still sends on desktop only (`Cockpit.tsx`). (2)
**Enter from reading mode** opens the cockpit, re-anchors to the latest message
and focuses the input — via a new `autoFocus` on the cockpit textarea
(`chat-page.tsx` keydown listener + `AutoSizeTextarea`/`Cockpit`). (3) **Focusing
the prompt clears the message selection** — new `clearExpanded` store action
fired from `InteractionMode`'s `onFocusCapture` (reading vs writing are separate
intents). (4) **Title-gen bug fixed — root cause + proper fix:**
`runOneShotCompletion` used a raw `{model,messages,stream:false,max_tokens:20}`
body that *bypassed the per-model adapter entirely* — reasoning models (esp.
`fixed-on` Kimi/GLM) burned the 20-token budget in their reasoning channel,
leaving `content` empty → silent fallback (invisible, since the fallback string
equals the null-title display). New `composeOneShotWire` routes one-shot through
the same adapter as `streamCompletion` (reasoning `{enabled:false}`, provider
headers, `stream:false`, drops `stream_options`); title-gen budget 20 → 256. (5)
**Un-pinning with an empty draft drops back to reading mode** (`Cockpit`). (6)
**Mindspace-tinted desktop scrollbar** — thin neutral default everywhere + accent
on `.chat-stream`; touch overlay behaviour untouched (`index.css`). (7) **Prompt
scrollbar gated on real overflow** — `overflow-y` set from measured height, no
flash on a new line that still fits (`AutoSizeTextarea`). Verification: typecheck
13/13; llm-unified bun 213/0; user-client vitest 546 pass / 8 fail (unchanged
pre-existing localStorage-jsdom baseline, confirmed identical on `master`); build
clean. One `interaction-mode` test updated for the new open-focused-by-default
behaviour. **Watch on device:** `autoFocus` fires on *every* cockpit open (incl.
reply-tap), so the mobile keyboard pops immediately — revisit if too aggressive.
**Next:** Chris pushes when ready; then Block-1 memory (chatsune port) per
[[ROADMAP]].

**Earlier 2026-06-01 — Provider & model handling rework
landed, squashed to `4c54661` on master (not yet pushed; awaiting Chris's device
test).** Spec/plan: [[../superpowers/specs/2026-05-31-provider-model-handling-rework-design]]
/ [[../superpowers/plans/2026-05-31-provider-model-handling-rework]]. What
changed: (1) **Modality `ServiceKind`** (`llm`/`web`/`tts`/`stt`/`tti`) added to
`Offering`, all built-ins backfilled `llm`; provider/aggregate caps are now
**derived from offerings** (`providerServiceKinds`/`aggregateServiceKinds`/
`providersContributing`/`MODALITY_ORDER` in `registry.ts`; `availableCanonicals`
in the canonical registry). (2) **Upstream Providers reworked**: the long
all-built-ins list is gone — `ProvidersSection` shows a global **CORS-proxy block**
(transitional, top of section), a **"What you have" modality summary** (greyed caps
carry a constructive "Add X to unlock Y" / "Coming soon" tooltip), a
**configured-only provider list** with derived status (`● Connected` / `✗ Needs
proxy` / `✗ Not connected`) + modality badges, a warm empty state, and a **`+`
AddProviderPicker** (excludes added providers, greys proxy-providers without a
proxy + a "Set up a CORS proxy →" shortcut, freedom-first order). (3) **`ProviderSheet`
slimmed** — proxy fields removed (proxy is global now), reads the global proxy for
its probe, blocks save with a constructive error if none set, flashes "LLM unlocked"
on success. (4) **Model picker** now lists **only usable models**, counts/TEE/ZDR/EU
badges over **configured offerings only**, drops disabled-deployment CTAs, adds a
quiet "＋N more models → My Settings" footer, a **"Currently unavailable"** row for a
persona whose model lost its provider, an **EU jurisdiction badge**, and **Tools/Vision**
hints. All 6 deredere extras in. New shared `lib/usable-providers.ts` ("usable" =
enabled + working route) is the single source for summary + availability. **No
Dexie migration** (all new state derived). **Larissa not triggered** (no
auth/sync/proxy-service/crypto path). Verification (measured, not assumed):
`pnpm typecheck` **13/13**; llm-unified `bun test` **213/0** (a cross-file
adapter-collision in `builtins.test.ts` was fixed with a shared
`_resetAdapterRegistryForTests`); user-client build **clean**; full user-client
vitest **546 pass / 8 fail across 3 files** — the 8 fails are the **pre-existing**
`chat-page`/`chat-route`/`cockpit-draft` localStorage-jsdom failures (unchanged
baseline, unrelated), confirmed stable across three full runs; **every new/modified
test file in this rework passes in the full suite**. **Process note:** the
intermediate task-commits were produced by an over-eager *batched* subagent
dispatch that raced on the shared `master` tree — HEAD churn, a
dropped-then-reflog-recovered Task-1 commit, and a duplicated CapBadgeRow commit
resulted. All cleaned up and **squashed to a single commit `4c54661`** (spec
`c8de708` + plan `564cb07` remain as their own `[skip ci]` doc commits). New
[[feedback_serial_subagent_dispatch]] memory records the lesson. **Next:** Chris
device-tests the 7 manual steps (spec §12) → Liz pushes. Next session also: the
usability polish Chris spotted while using the chat, then the [[ROADMAP]].

**Earlier 2026-05-31 — Roadmap locked + UI-polish round +
Mistral & OpenRouter onboarded.** Six commits on master, not yet pushed (pushing
as one package). (1) **Roadmap to beta locked** — [ADR 0031](decisions/0031-eight-block-roadmap-to-beta.md)
+ [[ROADMAP]]; v0.1.0 is a local-only alpha at Block 2; "mainstream provider"
gate relaxed. (2) **UI-polish round, all device-verified by Chris:** copy-toast,
desktop-only Enter-to-send (Shift+Enter = newline), and My-Circle Continue/New-Chat
(`ab34528`); offering picker now renders deployments **inline under the chosen
model** + **coloured TEE/ZDR badges** with tooltips (`dfa469e`); PWA updates apply
**silently on next cold start** (banner removed — a mid-session reload would drop
the in-memory MK and force re-unlock) (`a1b9782`). (3) **#5 Regenerate rebuilt
non-destructively — DONE on branch `feature/regenerate-non-destructive`, awaiting
Chris's device test before squash to master.** `useRegenerate` now re-rolls only
the last persona answer in place and never touches the user message. The streaming
core was extracted into `stream-manager.runIntoDraft`, shared by `start` (fresh
send) and a new `stream-manager.regenerate` (clears the target persona row,
re-streams into it). On stream failure the target stays `incomplete` so the
existing `StreamInterruptedFooter` offers Retry; on abort mid-regenerate the
target is preserved (not deleted) via a `reusedDraft` flag on the handle.
Persona/secret resolution is now a shared `resolvePersonaContext` helper. The
chat-route regenerate test that was missing now exists and genuinely clicks the
button. Spec + plan under `superpowers/` (2026-05-31). 6 commits on the branch;
the 8 cockpit-draft/chat-page/chat-route localStorage-jsdom failures remain
pre-existing (verified identical on master).
(4) **Mistral + OpenRouter onboarded** (`e00de39` canonicals, `3bb3ebb` providers,
`d027e9a` doc): 3 Mistral flagship canonicals; **Mistral direct** (`mistral-openai`
adapter handles the polymorphic thinking-in-`delta.content`, reasoning toggle
high/none, usage on finish_reason; **CORS-direct, no proxy**) + **via nano-gpt**
(fully green 22/22 +vision); **OpenRouter** re-offers our 8-model canonical set
(MiMo excluded; all clean `toggle` incl. GLM-5.1/Kimi which are fixed-on elsewhere;
CORS-direct). Both freedom-oriented (Chris). Closed the **tensorix client-list gap**
(registered but never in settings); client provider list now matches all 8
built-ins. **Mistral via OpenRouter investigated + EXCLUDED** — proprietary
Mistral 404s under a privacy-oriented OR data-policy (which most of our users
run) + free-tier rate-limit; documented in `providers/openrouter.md`.
typecheck 13/13; llm-unified 204 Bun; user-client 518 (the 8 cockpit-draft/
chat-page/chat-route localStorage-jsdom failures remain pre-existing). **Next:**
Chris device-tests `feature/regenerate-non-destructive` (5 manual-verification
steps in the plan) → squash to master, then Block-1 memory (chatsune port).

**Earlier 2026-05-31 — Retry observability shipped + latent
`ERR_BODY_ALREADY_USED` bug fixed across all three provider-call sites** (commit
`7402231`): sink-agnostic `onRetry` hook, pure `formatRetryEvent`, new
`withStreamingRetry` helper consolidating the streaming loops, console sinks at
every call-site, 30s one-shot timeout; `llm-unified` stays dependency-free;
prom-client metrics deferred to the Phase-2 proxy. 192 tests green. Stale Phase-4
status corrected: alpha-release ceremony deferred into the 4-week roadmap (squash
abandoned — already pushed + buried). See "Doing now". **Prior entry —** Tensorix
onboarded: 5 EU-sovereign ZDR offerings curated. New provider `tensorix` (`https://api.tensorix.ai/v1`, OpenAI
chat-completions, `corsHint: direct`, sortPriority 12). ZDR is policy-default &
EU-sovereign (Irish co. 796387, Dublin+Helsinki, GDPR Art. 44) — `trust:
{tee:false, zdr:true, jurisdiction:'EU'}`, always-on (no per-request header,
unlike wafer). Curated: deepseek-v3.2, deepseek-v4-pro, glm-5 (`toggle`, clean off
0/6) + glm-5.1, kimi-k2.6 (`fixed-on` — off leaks 6/6 on unique prompts, like
wafer's Kimi). **DeepSeek V4 Flash excluded** — reasons only in bare `content`, no
steerable channel. Key trap: Tensorix **response-caches identical prompts**, which
made the conversation-suite read false reasoning verdicts (a repeated off-prompt
returns a cached trace-free reply); the per-model off-switch was settled by a
**unique-prompt off-leak probe**, not the suite. AUP not machine-verifiable
(client-rendered 404) — freedom rests on Chris's chatsune experience.
`builtins.test` → 6 providers + a tensorix case; new `tensorix-scanner` (+test),
`tensorix-openai` adapter, `run-tensorix-suite.ts`. Records: `providers/tensorix.md`
(new) + the six model records updated. **Not pushed.**

**Earlier 2026-05-31 — MiMo V2.5 Omni + Pro curated on novita
(novita-exclusive).** Xiaomi's open-weight MiMo family — genuinely strong, but
scarce western compute outside China, so novita is the only workable home (Chris).
Two new canonicals (`mimo-v2.5-omni`, `mimo-v2.5-pro`) + two novita offerings, both
reusing the existing `novitaThinkingAdapter` (`enable_thinking` toggle with a clean
off, single-block tool calls, `reasoning_content` channel) — no new adapter.
**Omni** is vision-capable; **Pro** is text-only (novita 400s `image_url` →
"vision not support"). Context **recommended 200k / max 1M** (novita reports a 1M
ceiling; recommended at the smart non-agentic window per Chris) — the novita helper
now carries a separate `maxCtx`. Live suite green: both core permutations 16/16
(on+off) across both models; Omni **vision works** — 100% on real photos, ~88%
(23/26) on the synthetic solid-colour test image (a reasoning-leak artefact of that
image, the Kimi-24px class, not a product fault). `builtins.test` → 8 novita
offerings; `canonical-registry.test` → 10 canonicals. Records:
`models/mimo-v2.5-omni`/`-pro` (new) + `run-novita-mimo-suite.ts`. typecheck +
181 Bun tests green. **Not pushed.**

**Earlier 2026-05-31 — wafer DeepSeek V4 added (flash + pro,
non-ZDR serverless).** Two new wafer offerings on the existing
`deepseek-v4-flash`/`deepseek-v4-pro` canonicals — **non-ZDR** (zdr_supported:false;
no 🔒 badge, no `Wafer-ZDR` header), serverless & not China-routed (Chris).
Reasoning `toggle` with a **clean off** (`reasoning_effort:'none'` → 3/3 silent
incl. with tools — unlike Kimi). Context **recommended 200k / max 1M** (wafer's 1M
ceiling; recommended at our DeepSeek-V4 sweet-spot, Chris) — the offering helper now
carries separate recommended/max. (wafer reports `reasoning_tokens:0` even with a
trace; usage-present holds via total.) Live suite (`deepseek` filter) green;
`builtins.test` → 5 wafer offerings (3 ZDR); the suite runner gained an argv slug
filter. Records: `deepseek-v4-flash`/`-pro` + `providers/wafer` updated. **Not
pushed.**

**Earlier 2026-05-31 — wafer.ai onboarded + 3 ZDR flagship
models curated (GLM-5.1, Kimi-K2.6, Qwen3.5-397B-A17B).** New provider `wafer`
(`https://pass.wafer.ai/v1`, OpenAI chat-completions). Headline: **ZDR** modelled
as an always-on 🔒 trust badge (Chris's call) — the adapter sends
`Wafer-ZDR: required` for ZDR offerings only (non-ZDR models 422 the header).
**Adapter-contract extension:** `WireRequest.headers?` → `transport.extraHeaders`
(merged on the base headers), threaded via `stream-completion`'s new `buildWire`
— general/additive, reusable (e.g. OpenRouter attribution), all existing tests
unchanged. **Empirical findings (probe over docs):** reasoning is OpenAI-standard
`reasoning_effort` (`'none'`=off, low/med/high=on) but effort does **not**
modulate → modelled `toggle`; `Qwen3.5-397B-A17B` reasons despite `/models`
claiming `reasoning:false` → **new canonical** with `requiredCaps.reasoning:true`
(adapter always sends an explicit effort — *omitting* it hung the model 90 s);
`Kimi-K2.6` reasoning cannot be turned off on the adapter path — the live suite
emits a trace on every reasoning-off run despite `reasoning_effort:'none'` (2/2
runs; curl probes oddly silent, but the suite is the authoritative gate) → modelled
**`fixed-on`** (no reliable off; `enable_thinking:false` is a no-op). **CORS:**
wafer answers OPTIONS with 405 / no ACAO → `corsHint: 'requires-proxy'` (Bun-side
suite unaffected). **Live conversation-suite:** GLM-5.1 core 22/22; Qwen3.5 core
22/22 + vision; Kimi-K2.6 vision 4/4 + tools/memory/reasoning-on green (reasoning-off
not offered under `fixed-on`). `sortPriority:15`; `freedomOrientedDeployment:true` (Chris);
Qwen `freedomOriented:null` (pending Chris). Client `settings.tsx` +
`ProviderSheet` gained wafer; `builtins`/`canonical-registry`/`offerings` tests
updated. Records: `providers/wafer.md` + `models/qwen3.5-397b-a17b.md` (new),
`glm-5.1` + `kimi-k2.6` updated. **Not pushed** (ask Chris).

**Earlier 2026-05-31 — chutes reasoning on-switch fixed; the
"hidden reasoning" finding was an adapter bug.** Re-probing the two `reasoning-present`
reds (chutes DeepSeek-V3.2 + Gemma-turbo) overturned the 2026-05-30 premise: both
DO have working `reasoning_content` channels — the `chutesAdapter` just enabled
reasoning with `reasoning_effort`, which GLM/Kimi honour by default (masking the
bug) but DeepSeek-V3.2/Gemma ignore (they reason in bare `content` prose, 0
`reasoning_content` + 0 `reasoning_tokens`). Fix: symmetric `chat_template_kwargs`
toggle — ON `{enable_thinking:true}`, OFF `{enable_thinking:false}`. Effort does
not modulate (flat low/med/high), so **chutes reasoning is now a `toggle`, not
`steps`** (Chris's call). **All 5 chutes offerings live-green** (DeepSeek-V3.2 +
Gemma now pass `reasoning-present`; GLM/Kimi unaffected, no 400; Kimi+Gemma vision
green); nano-gpt + novita glm-5.1 spot-checked green with the new reasoning probe.
The suite's reasoning probe moved off the trivial greeting onto a non-famous
arithmetic word problem (conceptually right; the adapter fix is what cleared the
reds). Insight: [[insights/2026-05-31-chutes-reasoning-on-switch]] (supersedes the
2026-05-30 visibility note). Records + `providers/chutes.md` corrected. 169 src +
34 curation Bun tests green; repo typecheck 13/13. **Not pushed** (ask Chris). A
mid-session modelling spike — a `gemma-4-31b-turbo` canonical — was reverted once
the bug was found; Gemma stays one canonical (reasoning:true).

**Earlier 2026-05-30 — Batch 2: DeepSeek V4 + Kimi + Gemma
curated on nano-gpt & novita; vision suite added.** `deepseek-v4-flash`,
`deepseek-v4-pro`, `kimi-k2.6`, `gemma-4-31b` all live-verified on nano-gpt +
novita (8 new offerings, `heuristic`→`verified`); `glm-5` added to chutes earlier.
**Adapters generalised** (`nanoGptGlmAdapter`→`nanoGptSlugSwapAdapter`,
`novitaGlmAdapter`→`novitaThinkingAdapter`) — one adapter per provider now serves
all four families; dead `genericOffering` removed from nano-gpt/novita (every
offering there is verified). **Vision suite added** (`WireMessage` gained a
multimodal `content` union + `WireToolCall`; `visionScenario` + `assertVisionDescribed`
+ embedded 128x128 test image): Kimi & Gemma vision verified on nano-gpt + novita,
Gemma on chutes too. **Findings:** (1) the vision test image must be ≥~128px —
a 24x24 was mis-perceived as black by Kimi; (2) the chutes off switch is actually
`chat_template_kwargs: { enable_thinking: false }`, **not** `reasoning_effort:'none'`
(which 400s Kimi, esp. with an image) — now FIXED uniformly in `chutesAdapter`, so
chutes Kimi reasoning-off + vision both work (Kimi core 44/44, vision green); (3)
chutes DeepSeek-V3.2 and Gemma emit `reasoning_tokens` but **no `reasoning_content`
text** → `reasoning-present` fails for those two (a visibility characteristic, open
follow-up: model their `reasoning` as visible-or-not). Freedom (Chris, 2026-05-30): DeepSeek/Kimi/Gemma all
`freedomOriented: true`, nano-gpt/novita deployments `true` → 🕊️ free. Records
written/updated for all five. 168 src + 34 curation Bun tests green; repo
typecheck clean. **Prior entry —** GLM family curated across three
providers via `/curate` (first batch). `glm-5` + `glm-5.1` live-verified on
**chutes, nano-gpt, novita** (ollama-cloud out — currently down). Six offerings
now `confidence: 'verified'` with hand-written catalogue adapters: new
`nano-gpt-glm` (slug-swap reasoning) + `novita-glm` (`enable_thinking` toggle)
adapters; `glm-5` added to chutes; `glm-5.1` re-confirmed. **Three heuristics were
wrong and are fixed:** nano-gpt is slug-swap not body-flag; novita's off-switch is
`enable_thinking:false` (the heuristic `reasoning:{enabled}` doesn't disable);
nano-gpt's `glm-5` cannot disable reasoning at all → `fixed-on`. **Suite improved:**
the `memory-echo` turn was flaky (open prompt measured intelligence, not the pipe —
violated D8); now a deterministic recall question, green across all providers.
Freedom (Chris, 2026-05-30): GLM `freedomOriented: true`, nano-gpt + novita
deployments `true` → 🕊️ free. `obsidian/models/glm-5.md` (new) + `glm-5.1.md`
(rewritten) Records. 168 src + 32 curation Bun tests green; repo typecheck clean.
**Runner fix (done):** `WireMessage` gained `tool_calls` (+ `WireToolCall`), and
the suite runner now replays the `assistant(tool_calls)` message and answers every
call with a `tool` result before continuing — well-formed multi-turn history.
Verified live (glm-5.1 on all three providers green). **Prior entry —** Slice 2
shipped: the client is
canonical-first, end-to-end live-verified, and chutes works for real. Four
squash-merged feature commits on master (pushed): (1) **Slice 2 — client
catalogue migration** (`3a31278`): the client moved off `KnownModel`/`knownModels`
onto `CanonicalModel`/`Offering`; model selection is **canonical-first** (pick a
model → pick an offering, top-ranked configured one pre-selected, unconfigured
providers disabled with a CTA); cockpit + reasoning-resolver moved to
`ReasoningControl`; context gauge reads `Offering.context.recommended`; an in-code
canonical registry + per-provider `offerings` + `rankOfferings`/`listOfferings`/
`getOffering`; runtime takes a minimal `CompletionTarget`; persona gained
`canonicalId` (DB v8, clean break); `KnownModel`/`ReasoningCapability` removed.
(2) **Add Chutes to the settings provider list** (`be623a1`): a pre-existing gap —
chutes was registered but the settings UI hard-coded only the three older
providers, so its key could not be entered. (3) **Fix chutes reasoning-off + suite
reasoning assertions** (`6b25ac5`): live-probe found GLM-family models on chutes
reason by default — `reasoning_effort:'none'` is the true off-switch (omitting
does **not** disable); adapter repaired and re-verified e2e via `makeLiveBinding`;
the conversation-suite grew `permutationsForReasoning` so it now catches this
class. (4) **Alias llm-unified to source** (`42d9d2b`): the user-client resolved
llm-unified via stale `dist/`; aliased to TS source so curation/adapter changes are
live in dev without a rebuild. **Manual verification passed on device** (picker,
chutes-TEE pre-select, reasoning off/low/high all live). 168 src + 32 curation Bun
tests green; `pnpm typecheck` 13/13; both builds clean. (8 pre-existing user-client
vitest env failures — `localStorage` jsdom harness in cockpit-draft/chat-page/
chat-route — are unrelated to this work.) The `/curate` Mode 3 flow proved itself:
a real bug, live-diagnosed and repaired.

**Earlier 2026-05-30 — Chutes live-curated; catalogue→runtime Slice 1 wired.**
Three feature units landed on master, all squash-merged:
(1) the **`/curate` skill** (`4dd4f58`); (2) **runtime adapter dispatch — Slice 1**
(`ba26ab4`): `streamCompletion` now routes through a per-model `ModelAdapter` via
an `adapter-registry` when a model carries `adapterId`, gaining correct fragmented
tool-call reassembly, `usage` emission, and a tools-capable `buildRequest`;
adapter-less models keep the byte-identical generic path (`_reasoning-body` +
`parseOpenAiSseStream`); a shared SSE framer (`frameSseEvents`/`eventToTokens`)
backs both; (3) **chutes curation** (`38cd90b`): the `chutes-openai` adapter
factory, the `chutes` provider with 4 TEE models (DeepSeek V3.2, Kimi K2.6, GLM
5.1, Gemma 4 31B Turbo) wired to per-model adapters, the chutes `ProviderScanner`,
a **live conversation-suite `RunnerBinding`** (own fetch → captures HTTP status,
no throw; retries transient 429/5xx), and Curation Records. Provider order now
**chutes < novita < ollama-cloud < nano-gpt**. **Live-validated** against real
chutes: DeepSeek V3.2 20/20 (usage + `generate_image` tool fire + memory all
green); Gemma adapter proven (reasoning-off green incl. tool fire — no
tool-reluctance), reasoning-on hit chutes rate-limiting (429, captured correctly).
173 src + 24 curation Bun tests green; build + typecheck clean. master is 11
commits ahead of origin — **not pushed**.

**Decided today:** the catalogue + per-model `ModelAdapter` layer (and the
`/curate` skill) target a layer that was **not** runtime-wired — the client used
`ProviderDefinition.knownModels` + the generic parser. We decided to **wire it in
three slices**: Slice 1 (runtime adapter dispatch) ✅ done; **Slice 2** (client:
`KnownModel`→`Offering`/`CanonicalModel`; cockpit + reasoning-resolver
`ReasoningCapability`→`ReasoningControl`) and **Slice 3** (catalogue
loading/bundling; registry populated from `Offering.adapter`) remain. Endpoint
rule fixed: always `/chat/completions`, never `/responses` (we hold context).
Specs/plans: [[../superpowers/specs/2026-05-30-runtime-adapter-dispatch-design]],
[[../superpowers/specs/2026-05-30-chutes-curation-and-live-suite-design]].

**Next session:** options — (a) **Slice 3** (catalogue loading/bundling; the
adapter registry populated from `Offering.adapter` instead of hand-registered in
`registerChutes()`; YAML model files → bundled runtime catalogue); (b) **confirm
reasoning-off for the other chutes models** (DeepSeek V3.2, Kimi K2.6, Gemma) — the
`reasoning_effort:'none'` fix is adapter-level so it should generalise, but only
GLM 5.1 was live-probed; a quick `/curate` verify (now with the suite's reasoning
assertions) closes it; (c) curate more chutes models or another provider via
`/curate`; (d) optional cleanup of the orphaned untracked spike leftovers
(`models/glm-5.1.yaml`, `packages/llm-unified/fixtures/deepseek-v4-pro.fixtures.json`).
Slice 2's two minor follow-ups were both done this session (vite alias, suite
reasoning assertion). master is pushed to origin.

---

**Earlier 2026-05-30 — `/curate` skill landed; synthesis pipeline +
curation CLI retired** (squash `4dd4f58` on master). The fixed-prompt machine
synthesis loop is replaced by an interactive `.claude/skills/curate/` skill in
which Claude authors adapters (one router `SKILL.md` + 7 reference playbooks:
provider-onboarding, model-curation, verify-offering, batch-check,
conversation-suite, + shared catalogue-model/conventions). `src/synthesis/` and
the `src/curate/` CLI driver are deleted; the hand-written `provider-scanner` +
`model-file` moved to `src/providers/curation/`. Adapter verification is now a
deterministic **conversation-suite** (`packages/llm-unified/curation/conversation-suite/`):
pure protocol/mechanical asserts (no intelligence judgement), run **locally,
never in CI** (provider keys never in CI); the suite grows with the
inference-runner (new CLAUDE.md §10 rule). `NormalisedUsage` + a `usage`
`StreamChunk` variant added. Adapters live in `src/adapters/` implementing the
`ModelAdapter` contract (`adapter-contract.ts`); the `nano-gpt-deepseek.baseline`
is the reference. typecheck + build clean; 150 Bun tests green. master is 3
commits ahead of origin — **not pushed yet**. **Next session (with Chris):** play
`/curate` through end-to-end for one provider, then for a model (this is the live
manual verification, needs `NANO_GPT_API_KEY`); confirm the `src/adapters/`
location convention in practice. Spec/plan:
[[../superpowers/specs/2026-05-30-curate-skill-design]] /
[[../superpowers/plans/2026-05-30-curate-skill]].

**Earlier — 2026-05-29 (evening):** **Curation CLI (model-support factory)**
landed (`c5217b6`) — now retired (see above). Maintainer-only `packages/llm-unified/src/curate/` (not
shipped to clients): one YAML per model (human identity + offerings above,
machine `built:` block below), commands `provider list` / `model list` / `model
template` / `model build [--verify]` / `model report` / `model verify` (stubbed).
`build` probes the target, GLM-5.1 writes a per-offering adapter, validated
**baseline-free** via `validateAgainstFixtures` (structural: reflects the real
evidence + profile-gate; generalises to any target) with self-repair; writes the
adapter as a sibling `.ts`, the `built:` block back (comment-preserving), and a
deterministic report to `obsidian/models/<id>.md`. nano-gpt `ProviderScanner`
tames the `:thinking`/`-thinking`/`TEE/` slug zoo. 188 Bun tests green; typecheck
+ build clean; help + template smoke-tested offline. **Live `build` is Chris's
manual verification** (needs `NANO_GPT_API_KEY`). Tracked deferrals: per-provider
API key (single `NANO_GPT_API_KEY` today — split before a differently-keyed
target), the `--verify` post-build re-probe, `model list` badges, signing/feed,
Ollama catch-all, `model verify` drift. Plan:
[[../superpowers/plans/2026-05-29-curation-cli]]. This completes the
provider-integration tooling arc started this morning with the synthesis spike.

**Earlier 2026-05-29 (later):** **Catalogue data model** landed
(`2042be6`). New `packages/llm-unified/src/catalogue/` two-level layer:
`CanonicalModel` (curated identity + T/R/V `requiredCaps` + `freedomOriented`)
groups per-provider `Offering`s, each carrying its own measured `ModelProfile`,
`AdapterRef`, `context {recommended, max}`, `trust` (TEE/ZDR), and
`freedomOrientedDeployment`. Valibot `parseCatalogueEntry` enforces the
capability gate; `effectiveFreedom` is the three-state (free/restricted/unknown)
AND of model + deployment freedom. `ModelProfile` migrated off the spike's shape
— `reasoning` is now the UI-driving `ReasoningControl` union
(none/fixed-on/toggle/steps); context+confidence moved to the Offering. 168
Bun tests green; typecheck + build clean. This is the foundation; the **Curation
CLI** (maintainer factory) is the next plan. Two new specs landed:
[[../superpowers/specs/2026-05-29-model-catalogue-data-model-design]] and
[[../superpowers/specs/2026-05-29-curation-cli-design]] (plan:
[[../superpowers/plans/2026-05-29-catalogue-data-model]]). Provider-integration
strategy decided: model-first curated catalogue + provider-first "Your Endpoints"
for local/uncurated; build-time generation (no signing/feed yet); two badges
(🔒 Privacy, 🕊️ Freedom).

**Earlier today (2026-05-29):** **Agentic adapter-synthesis spike** landed
(squashed at `ac40a3e`). New `packages/llm-unified/src/synthesis/` subsystem:
an analyzer model (GLM-5.1 via nano-gpt) empirically probes a target model,
captures raw SSE fixtures, then writes a per-model adapter — pure `buildRequest`
+ `parseChunk` + declarative `ModelProfile` per the new `adapter-contract.ts` —
accepted only after replay-validation reproduces the captured behaviour AND
matches a hand-ported DeepSeek baseline (which doubles as the validation oracle
and correctly reassembles fragmented streamed tool calls — the case the live
`streaming.ts:112` parser still gets wrong). ≤3 self-repair rounds, then a
conservative heuristic fallback. Generated adapters run in a **Bun Worker**
isolation stand-in (watchdog + teardown) — explicitly NOT the production
security boundary; the production sandboxed-iframe boundary and a Larissa pass
on the execution model are **deferred** follow-ups. The probe suite targets the
empirical unknowns: slug-vs-flag reasoning, effort/`max` acceptance,
off-is-off-vs-hidden (→ `always_on`), streaming-vs-block tool calls,
reasoning+tools concurrency. 155 source Bun tests green (`bunfig.toml` roots the
runner at `./src` so stale `dist/` copies no longer pollute the run); typecheck
+ build clean. **Live run is Chris's manual verification**: `bun run synthesise`
from `packages/llm-unified` with `NANO_GPT_API_KEY` set (see `.env.example`).
Spec: [[../superpowers/specs/2026-05-29-agentic-adapter-synthesis-design]];
plan: [[../superpowers/plans/2026-05-29-agentic-adapter-synthesis]].

**Earlier:** 2026-05-28 (About-disclaimer-and-licences squashed
following Chris's review of the Phase-4 alpha-prep build). Replaces the
old Version/Licence/Documentation `dl` in My Account → About with: a
Privacy & data handling disclosure (three paragraphs — where data lives,
what the app cannot see, external providers), a Third-party libraries
disclosure (12 curated entries — React, Tailwind, Dexie, Valibot, … —
each with version, SPDX licence, and homepage link), and a flat
licence-and-links footer with four external links (FSF AGPL-3.0 text,
GitHub source, Our Provider Integration Policy at
teaser.chatsundere.me/policy, chatsune.me docs). Native `<details>`
disclosures, no new component; the AGPL text is **not** bundled —
[ADR 0030](decisions/0030-link-to-fsf-licence-text.md) explains why.
~11 new Vitest cases on `account.about.test.tsx` (privacy ×2 +
third-party ×4 + licence footer ×4 + existing mono-box). Pre-Phase-4
alpha-prep baseline at `b6ba252` plus ALPHA-DEPLOY walkthrough at
`381184c` remain the foundation under this work.

**Phase 4 simple-history (2026-05-26 evening, squashed at `ec7c1f3`):**
Bridge release between Phase 4 CoT-display and the alpha-prep cycle.
New `/app/history` route lists chats sorted by `lastMessageAt` desc with
title-substring search, persona-filter chips (NSFW-aware), inline
rename, inline delete-tray (6 s auto-collapse) and constructive empty
states. Chat-View Topbar's centre became a two-row title+persona stack
— tap-to-inline-edit the title with `🖎` pencil affordance, persona-name
row below remains the tap-target to the Persona Editor. Persona-Editor
quick-actions row switched from `grid-cols-3` to `grid-cols-2` 2×2 with
a new `History` button that navigates to `/app/history?personaId=<id>`
(disabled when the persona has no chats). Title-generator upgraded to
the chatsune-style prompt (inline NSFW unlocker + conversation-
language) and gained a race-guard re-read in both success and catch
branches so an auto-title never overwrites a manually-set one under
load. No Dexie bump — re-uses `ChatRow.title: string | null`. Spec
Decision 13 (Today/Yesterday/Earlier date-group headers) was prototyped
and dropped per its own LOC budget (54 net new lines vs ~30 cap);
deferred to Phase 5.

Phase 4 itself (squashed at `3efc12b`, 2026-05-25 night) landed
chain-of-thought display: a closed-by-default mindspace-tinted pill
renders next to each persona-message that carries reasoning, with
sequential dot-pulse animation while live, opening to stream the trace
in the persona font with `white-space: pre-wrap`. Pill renders only
when a trace exists (no empty stub). Reasoning-OFF translation
completed for all three providers (nano-gpt slug-swap / flag-body,
Novita unified `{reasoning:{enabled,effort}}`, Ollama-Cloud
`{think:bool}`) via a new `ReasoningIntent` discriminated union and the
`_reasoning-body.ts` adapter. Reasoning is consolidated through
`lib/content-blocks.ts` (flattenAnswerText/coalesceAdjacent/groupAdjacent)
so it never leaks to clipboard, wire, or context-gauge. Dexie at v7.
Pre-Phase-4 hotfix `832aa79` preserved the NSFW-Panic draft (was
discard, now keeps the partial buffer for StreamInterruptedFooter
Retry/Discard on re-visit).

---

**Phase 3.1 baseline (squashed at `6c2f9fa`, 2026-05-24):**
27 task-commits landed sequentially on master (`464e244` → `ba27f25`),
each TDD-paired per spec §10. Across the work: `packages/llm-unified`
gained
`ReasoningCapability` + `ReasoningEffortSpec` (ported from chatsune)
and an extended `KnownModel` (`contextWindow`, `reasoning`, `vision`,
`tools`), six curated `KnownModel[]` entries per provider sourced from
`FIRST-MODELS.md` (DeepSeek V4 Pro+Flash, GLM 5+5.1, Kimi K2.6,
Gemma 4 31B), a nano-gpt pair-map (`slug`/`flag`/`none` switching),
high-level `streamCompletion` + `runOneShotCompletion` helpers with
the nano-gpt pre-flight hook inline, and 132 Bun tests across 24 files
(all green). `apps/user-client` gained Dexie v6 (`ChatRow.draftInput`),
`current-chat.store` (UI mode + reasoning state + expansion exclusivity),
`stream-manager.store` (parallel `Map<chatId, StreamHandle>` with
`abortDiscard` semantics), a pure `stream-engine` orchestrating
composition + reasoning-resolver + streamCompletion, `lib/`
helpers (`reasoning-resolver`, `token-estimator`, `cockpit-draft`),
TanStack hooks (`useChat`, `useCreateChat`, `useUpdateChat`,
`useToggleBookmark`, `useSendMessage`, `useRegenerate`), and a full
set of chat components: `DateSeparator`, `Pill`, `MessageBlock` +
`MessageControls`, `ChatStream` + `StreamingCursor`, `BottomAffordance`
+ `ScrollToEnd`, `PersonaGreeting`, `InteractionTopbar`,
`CockpitMenu`, `Cockpit` + `DualActionBtn`, `DimOverlay` +
`InteractionMode`. Routes registered for `/app/chat/new` and
`/app/chat/:chatId`; `ChatPage` assembled with real wiring (lazy +
chat-mode, draft persistence across modes, send-flow, regenerate,
auto-follow + sacred bottom edge + scroll-to-end swap). All 353
user-client Vitest tests pass across 80 files; full `pnpm typecheck
&& pnpm lint && pnpm --filter user-client run build` clean. Spec:
[`superpowers/specs/2026-05-24-phase-3-chat-design.md`](../superpowers/specs/2026-05-24-phase-3-chat-design.md).
Plan: [`superpowers/plans/2026-05-24-phase-3-chat.md`](../superpowers/plans/2026-05-24-phase-3-chat.md)
(Tasks 1–27 of 41). Phase 2.9 + iterations 7-8 (`6553224`, `86975d7`,
`1b8dd02`) remain the previous baseline.

**Manual smoke pending for Phase 3.1:** spec §11.3 items 1–3, 8, 9
(item 10 = title-gen, deferred to 3.3; items 4–7 = Background-Stream /
Multi-Chat / NSFW Panic / Pin, deferred to 3.2). After smoke, the 27
task-commits will be squashed into a single Phase-3.1 commit (per
plan Task 28).

This file tracks **client-only / standalone-mode work** — everything
the user-client can do without talking to a server. The goal is that
Chatsundere is an excellent experience even in pure-local mode; sync,
homelab, and sidecar live on the server side and are tracked in
[[STATUS-BACKEND]]. Read both files at the start of every session;
update the relevant one at the end.

---

## Scope

### In scope here

- Local chat experience (UI, message rendering, session shape)
- LLM provider integration as far as the client owns it (model
  selection, prompt routing, per-provider auth)
- Local storage of chat sessions / conversation context
- User-facing UX patterns (pill handling, expressive feedback,
  organic variation, omakase defaults)
- Data model for future tool support (stored only, no execution)
- Neurodivergent-accessibility behaviour and review surfaces

### Deliberately out of scope (deferred)

- Tools execution (data model lives here; no execution surface)
- Knowledge bases / libraries
- Integrations (homelab, sidecar)
- Voice (Block 4 — Chris's expressive-voice concept lands later)
- Cloud sync ([[STATUS-BACKEND]] territory)

---

## Done

- **Status-tracking split (2026-05-23)** — STATUS.md → STATUS-BACKEND.md;
  STATUS-CLIENT-ONLY.md established for the standalone-mode side; cross-
  refs set. CLAUDE.md §6/§15-layout/§16 updated to reference both split
  files (2026-06-01) — the old single-STATUS.md references are gone.
- **UX-CONCEPT.md landed (2026-05-23)** — full operating-concept brief
  by Chris + Lyra; serves as the North-Star concept document for the
  client-only work. Open Questions section flags Mindspace palette,
  textures, voice-pill treatment, et al.
- **First interactive wireframe (2026-05-23)** —
  `chatsundere-prototype.html`. Covers Reading Mode + Interaction Mode
  + Entrance Hall + Treasury. Visual ground truth for Phase 3.
- **Block 1 design spec (2026-05-23)** —
  `superpowers/specs/2026-05-23-client-block-1-design.md`. 16 captured
  decisions, 4-phase implementation plan, 15 acceptance criteria.
  Chris-approved.
- **Phase 1 implementation plan (2026-05-23)** —
  `superpowers/plans/2026-05-23-client-block-1-phase-1-backbone.md`.
  13 tasks, fully TDD-structured. Subagent-driven execution.
- **Phase 1 — Backbone, complete (2026-05-23)**. Squashed into one
  commit. What landed:
  - `apps/user-client/src/lib/secrets.ts` — DEK-backed AES-GCM seal/open
    with `slotId` AAD binding (defends against ciphertext-swap across
    storage slots). 10 Vitest tests.
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie DB
    `chatsundere_client_data` with seven tables (settings, providers,
    personas, mindspaces, chats, messages, pills), UUIDv7 IDs per
    ADR 0025, idempotent v1-seeding of three built-in mindspaces
    (Aurum, Azuro, Verdan) + settings singleton. Boot opens both
    crypto DB and client-data DB in parallel. 5 Vitest tests.
  - `apps/user-client/src/routes/onboarding/matrix.tsx` — three
    server-coupled cells disabled with `aria-disabled` + "Coming with
    Block 2" tooltip per UX-CONCEPT "Disabled over Hidden"; only
    "Just this device" remains an active link. 3 Vitest tests.
  - `packages/llm-unified/` — full library: 7 modules + 3 built-in
    providers + 7 test files. Registry pattern ported from
    `../chatsune/backend/modules/providers/_registry.py`.
    Single OpenAI-chat-completions adapter shape; three pre-registered
    providers (nano-gpt, Novita AI, Ollama Cloud) with CORS hints
    (`inofficial` / `direct` / `requires-proxy`). Transport routes
    direct or via cors-proxy. Hand-written SSE parser with split-chunk,
    abort-signal, and tool-call support. System-prompt composition is
    a pure module with stub Project + Memory slots. Probe surfaces
    structured ProbeResult for "Test Connection". 41 Bun tests.
  - Test runner split per CLAUDE.md: Bun for `packages/llm-unified`,
    Vitest for `apps/user-client`. Both clean.
  - New deps: `dexie@^4` and `uuidv7@^1.0.2` in user-client.
  - Two minor follow-ups noted for later (not blocking): (a) add input
    validation to `hexToRgb` in `client-data-db.ts` before a Phase-2+
    palette editor wires it up to user input; (b) consider extracting
    the duplicated `asMockFetch` helper if a third llm-unified test
    file needs it.

## Done (continued from Phase 1)

- **Phase 2 — Settings + Circle + Persona Editor + Entrance Hall
  (2026-05-23 evening)**. Squashed into one Phase-2 commit. What landed:
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v2 migration
    with `.upgrade()` backfilling `Settings.userFont = 'serif'` and
    `PersonaRow.{tagline:'', temperature:0.85, adultPersona:false}`
    on existing rows; seven built-in mindspaces (Crimson, Aurum,
    Verdan, Azuro, Indigaut, Violetta, Rosari) using Lyra's finalised
    hex values; Verdan/Azuro accent hex refreshed from Phase-1
    provisional values.
  - `apps/user-client/src/state/{mindspace-resolver,mindspace.store}.ts`
    — pure resolver + Zustand store driving the active palette.
  - `apps/user-client/src/components/{MindspaceLayer,MindspaceTexture,
    MindspacePicker,PersonaCard,AccordionCard,ProviderSheet,SaveBar}.tsx`
    — the Phase-2 component library. MindspaceTexture ships three
    CSS-only variants (cloudy, aurora, grain) with respect for
    `prefers-reduced-motion`.
  - `apps/user-client/src/data/{queryKeys,settings,personas,providers,
    mindspaces,chats}.ts` — TanStack-Query data layer over Dexie with
    full CUD for personas / providers, plus query-only access for the
    rest.
  - `apps/user-client/src/routes/app/{entrance-hall,circle,
    persona-editor,settings}.tsx` — the four Block-2 surfaces wired
    to data + state, with accordion accordions, FAB navigation,
    save-bar validation, delete-zone with cascade, etc.
  - `apps/user-client/src/App.tsx` — wired `/app` subroutes
    (`/app`, `/app/circle`, `/app/persona/new`, `/app/persona/:id`,
    `/app/settings`); MindspaceLayer mounted at root; `app-shell.tsx`
    placeholder removed.
  - Tests: 63 new Vitest cases across mindspace engine, data layer,
    components, and the four routes; all 129 user-client tests pass.
    Phase-1 packages (crypto, llm-unified) remain untouched and green.

- **Phase 2.5 — Polish & Bug-Bash (2026-05-24)**. Eight commits on
  master following Chris's device-smoke of Phase 2. Twelve plan tasks
  driven via subagent-driven-development. What landed:
  - `apps/user-client/public/fonts/` — self-hosted Lora (Regular +
    Italic, ported from chatsune) and Inter variable (from
    upstream `rsms/inter`). `src/index.css` `@theme` block points
    `--font-display` at Lora and `--font-sans` at Inter. No CDN
    call at runtime.
  - `apps/user-client/src/lib/monogram.ts` — kollision-free port of
    `chatsune/backend/modules/persona/_monogram.py`. Five-strategy
    fallback (multi-part initials → letter pairs → doubled first →
    AA…ZZ → '??'). 8 Vitest tests; existing `monogramFor` callers
    keep their one-arg API via a thin wrapper.
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v3
    migration adds `SettingsRow.userTexture` and
    `PersonaRow.textureOverride`; backfills both from existing rows
    via a raw-Dexie plant-then-reopen pattern. `MindspaceRow.texture`
    survives only as a seed-default for first-install.
  - `apps/user-client/src/state/mindspace-resolver.ts` +
    `mindspace.store.ts` — new `ResolverArgs` accepts `defaultTexture`;
    texture priority is `persona.textureOverride > settings.userTexture > mindspace.texture`.
    Resolver returns `ResolvedMindspace | null` instead of throwing on
    an empty mindspaces list.
  - `apps/user-client/src/components/MindspaceLayer.tsx` — wraps the
    texture in `position: fixed; inset: 0; pointer-events: none;
    z-index: -1; overflow: hidden`. The background now spans the
    whole viewport regardless of content height or scroll position.
  - `apps/user-client/src/components/MindspacePicker.tsx` — preview
    card renders an actual `MindspaceTexture` sample (was a flat
    colour panel). Texture and Colour are now genuinely orthogonal;
    selecting a colour never invokes `onTextureChange`.
  - `apps/user-client/src/components/AutoSizeTextarea.tsx` — new
    component; replaces fixed-height textareas across About Me,
    Global System Prompt, Custom Instructions, About Me Override.
    Strictly controlled with `value` + `onChange`; growable up to
    optional `maxRows`.
  - `apps/user-client/src/components/ProviderSheet.tsx` — opaque
    `bg-ink` body with a click-through `bg-black/60 backdrop-blur-sm`
    backdrop; explicit Cancel + Test & Save buttons; closing via ×
    discards the in-progress edit; password-manager autofill
    suppressed (`autoComplete="off"`, `data-1p-ignore`,
    `data-lpignore="true"`, empty `name`); proxy URL placeholder
    is `https://example.com`. The Ollama-Cloud save bug is fixed —
    the freshly-sealed shared key is held in a local variable and
    used directly for the probe instead of being re-read from the
    stale TanStack-Query cache.
  - `apps/user-client/src/routes/app/circle.tsx` — FAB `+` glyph is
    visible again (`text-bg` was undefined; replaced with `text-ink`;
    glyph bumped from `text-2xl` to `text-3xl leading-none`).
  - `apps/user-client/src/routes/app/persona-editor.tsx` — Identity
    (Name + Tagline) lifted out of the accordion, always visible at
    the top. Accordion order is Custom Instructions → Model →
    Behavior → Mindspace-Override → About-Me-Override.
    Required-field markers (red ✕) render on the accordion header
    via the new `AccordionCard.requiredMarker` prop, and inline next
    to Name when empty. Save requires `modelId` in addition to
    `providerId`. A `userModifiedRef` prevents the draft-seed
    `useEffect` from overwriting in-progress edits when upstream
    data refetches.
  - `apps/user-client/src/routes/app/settings.tsx` — wires the
    Mindspace-Picker to `SettingsRow.userTexture`; About-Me and
    Global System Prompt use the new `AutoSizeTextarea`. Removed
    the now-unused `useUpdateMindspaceTexture` import path.
  - `apps/user-client/src/data/mindspaces.ts` — `useUpdateMindspaceTexture`
    hook removed (texture no longer lives on the mindspace row).
    `useMindspaces` retained.
  - Tests: ~16 new Vitest cases across monogram, db v3 migration,
    MindspaceLayer wrapper, picker controlled-API regression,
    AutoSizeTextarea structural contract, ProviderSheet polish, and
    persona-editor required-field markers. All user-client tests
    green; llm-unified tests green.

- **Phase 2.6 — Polish Iteration 2 (2026-05-24)**. Nine commits on
  master following Chris's iteration-2 device-smoke of Phase 2.5.
  Ten plan tasks driven via subagent-driven-development. What landed:
  - `apps/user-client/src/components/EditorTopbar.tsx` — new shared
    topbar component (40×40 back button with discard semantic +
    confirm-on-dirty; plain title centre; "Save & Back" pill right).
    Used by Persona Editor and My Settings.
  - `apps/user-client/src/components/AccordionCard.tsx` — `meta` prop
    widens from `string` to `ReactNode` so callers can compose
    dynamic previews.
  - `apps/user-client/src/components/SaveBar.tsx` — latent `bg-bg/95`
    transparency bug fixed (→ `bg-ink/95`). New `saveLabel?: string`
    prop lets each caller name its action ("Save Persona" / "Save
    Settings").
  - `apps/user-client/src/components/MindspacePicker.tsx` — new
    `hideFont?: boolean` prop suppresses the Font row when the caller
    handles font separately. Used by both the Persona Editor's
    Mindspace-Override (Font lives in Font-and-Voice now) and My
    Settings' Default-Mindspace (no user-font any more).
  - `apps/user-client/src/boot/client-data-db.ts` — `SettingsRow.userFont`
    removed. New personas default to `serif`. Existing rows with
    orphaned userFont are harmlessly ignored (Dexie schemaless for
    non-indexed fields; no version bump).
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mounts
    `EditorTopbar`; introduces `isDirty` state; splits Save into
    `onSaveStay` (bottom SaveBar, persists + stays) vs `onSaveAndBack`
    (topbar, persists + navigates); dynamic accordion metas for
    Model (`<provider> · <model>`), Behavior (NSFW badge pill when
    `adultPersona`), Mindspace-Override (`Using user default` or
    `<mindspace> · <texture>`); new Font-and-Voice accordion section
    between Behavior and Mindspace-Override (font chips + a hint
    that TTS lands later).
  - `apps/user-client/src/routes/app/settings.tsx` — converted to
    draft + Save flow. About Me, Global System Prompt, Default
    Mindspace edits write to local `SettingsDraft` state; SaveBar
    diffs and dispatches `updateSettings.mutateAsync` only on Save.
    Upstream Providers stay out-of-band (per-provider Test & Save).
    EditorTopbar mounted.
  - `apps/user-client/src/routes/app/circle.tsx` — drops "Room · "
    breadcrumb prefix; back button bumped to the 40×40 convention.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — removes the
    `settings.data?.userFont` lookup; heading now uses `font-display`
    directly.
  - Tests: 11 new Vitest cases across AccordionCard meta-as-node,
    EditorTopbar (6 cases), MindspacePicker hideFont, persona-editor
    dynamic-meta (3 cases), persona-editor Font-and-Voice (2 cases),
    settings draft-save (2 cases). Two existing tests adjusted for
    new UX (settings-route persists, persona-editor name-input).
    All 176 user-client tests pass.

- **Phase 2.7 — Account Room + Polish Iteration 3 (2026-05-24)**.
  Seven commits on master following Chris's iteration-3 device-smoke.
  Seven plan tasks driven via subagent-driven-development. What
  landed:
  - `apps/user-client/src/routes/app/persona-editor.tsx` — bottom
    `<SaveBar />` removed. EditorTopbar's "Save & Back" is the only
    persist path. Discard via Back (with confirm-on-dirty). `pb-32`
    → `pb-8`. `onSaveStay` function dropped.
  - `apps/user-client/src/components/AccordionCard.tsx` — gains a
    smooth `scrollIntoView({ behavior: 'smooth', block: 'nearest' })`
    on every open, guarded by an `isInitialRef` so accordions that
    mount with `defaultOpen={true}` don't auto-scroll.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — gains a
    sixth `RoomTile` "My Account" (icon `⌬`, meta "Identity & auth",
    route `/app/account`).
  - `apps/user-client/src/routes/root.tsx` — global topbar's
    gear-icon shortcut to `/settings` is removed. `GearIcon` import
    dropped.
  - `apps/user-client/src/routes/app/account-sections/` — four new
    section components: `account-section.tsx` (port of old
    `/settings/account.tsx`), `auth-methods-section.tsx` (port),
    `about-section.tsx` (port), `server-linking-section.tsx` (newly
    authored — status + "Link to server" button).
  - `apps/user-client/src/routes/app/account.tsx` — new
    `AccountPage` route component. EditorTopbar with title "My
    Account"; four accordions in order Account / Auth Methods /
    Server Linking / About; `hideSaveAndBack` suppresses the
    Save & Back pill (no global draft to persist).
  - `apps/user-client/src/components/EditorTopbar.tsx` — new
    optional `hideSaveAndBack?: boolean` prop; when true, swaps
    the Save & Back button for an 88px-wide spacer to keep the
    centred title balanced.
  - `apps/user-client/src/routes/onboarding/invitation/_return-url.ts`
    — new shared helper exposing `useReturnUrl()` (default
    `/onboarding`) and `useNavTarget()` for forward-step search-
    preserving navigations.
  - `apps/user-client/src/routes/onboarding/invitation/{form,scan,
    confirm,recovery-reveal}.tsx` — all four step files now read
    the `?return=` query param via the helper for their exit-wizard
    back-targets; forward-step navigations preserve the search
    string so the return-URL flows through.
  - `apps/user-client/src/routes/change-passphrase.tsx` — link
    targets migrate from `/settings*` to `/app/account`.
  - `apps/user-client/src/App.tsx` — registers `<Route
    path="/app/account" element={<AccountPage />} />`. Drops the
    `/settings/*` route block and the five `SettingsLayout/Account/
    AuthMethods/ServerLinking/About` + `Navigate` imports.
  - `apps/user-client/src/routes/settings/` — entire directory
    deleted (layout.tsx + four sub-page files).
  - Tests: 4 new Vitest cases across AccordionCard scrollIntoView
    (2 cases), EditorTopbar hideSaveAndBack, account.tsx
    composition (2 cases), server-linking section navigation. All
    183 user-client tests pass.

- **Phase 2.8 — Polish Block (2026-05-24)**. Four squashed commits on
  master following Chris's pre-very-early-alpha polish ask. Driven by
  subagent-driven-development per task. What landed:
  - `apps/user-client/src/index.css` — new `.brand-logo` rules (cyan→
    pink→gold gradient + `✦` twinkle, identical to docs/index.html)
    plus `.splash-*` keyframes and reduced-motion overrides. Italic
    Lora wordmark replaced by the gradient brand mark in the topbar.
  - `apps/user-client/src/routes/root.tsx` — italic Lora wordmark
    replaced by the gradient brand mark; new topbarLogoRef passed
    through `SplashContext` to the overlay; topbar logo held
    `opacity: 0` until the splash FLIP completes (or until the splash
    dismisses without one — 150 ms safety poll, capped at 3.5 s).
  - `apps/user-client/src/components/EditorSticky.tsx` (new) — shared
    sticky-region wrapper adopted by Persona Editor (topbar +
    Continue/New Chat/Incognito quick-actions in edit mode), My
    Settings (topbar only), and My Account (topbar only). `top-11
    lg:top-14 z-10` offsets the region to sit below the global root
    header (which is sticky `top-0 z-20`); exposes `data-editor-sticky`
    as a stable test selector instead of fragile class-substring
    matches. Identity and Delete-zone stay outside the sticky on
    purpose (Delete is meant to be slightly harder to reach).
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v4 migration
    adds `SettingsRow.displayName: string`, backfills `''` on existing
    rows, seeds `''` on fresh installs.
  - `apps/user-client/src/data/settings.ts` — `useDisplayName()` hook:
    trimmed `displayName` → `session.username` → `'—'`.
  - `apps/user-client/src/routes/app/account-sections/account-section.tsx`
    — new Display Name input block above the existing username
    section; live-write on blur via `useUpdateSettings`; max 60
    chars; whitespace-only normalises to empty; gated on a one-shot
    init flag so the settings-resolve seed can't overwrite in-flight
    user typing.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — "WELCOME
    BACK" greeting now uses `useDisplayName()` instead of
    `session?.username`.
  - `apps/user-client/src/components/{SplashContext,SplashOverlay}.tsx`
    (new) — cold-start splash overlay gated by
    `sessionStorage.splashShown`. Tap/Escape/3s-hard-timeout skip
    paths; `prefers-reduced-motion` reduces to a 200 ms crossfade.
    FLIP migration computes `transform: translate(Δx,Δy) scale(s)`
    from `getBoundingClientRect` deltas and applies it with
    `transition: transform 500 ms ease-in-out`; on completion
    dispatches `chatsundere:splash-flip-done` for Root to flip the
    topbar opacity to 1.
  - Tests: 20+ new Vitest cases (EditorSticky 5 incl. data-attribute,
    SplashOverlay 6 incl. null-ref bailout, client-data-db-v4 2,
    useDisplayName 4, account.display-name 3, entrance-hall.greeting
    2, root.brand-logo 2, root.splash 2, persona-editor.sticky 1,
    settings.sticky 1, account.sticky 1). All 212 user-client tests
    pass; llm-unified Bun tests untouched and green; full
    `pnpm typecheck && pnpm lint && pnpm --filter user-client run build`
    clean.

- **Phase 2.9 — Mindspace Cards & Adult Mode (2026-05-24)**. One
  squashed commit on master following Chris's pre-very-early-alpha
  brainstorm. Driven by subagent-driven-development per task. What
  landed:
  - `apps/user-client/src/boot/client-data-db.ts` — Dexie v5 migration
    adds `SettingsRow.adultMode: 'nsfw' | 'sfw'`; default `'nsfw'`
    (per spec §2 Decision 2 — SFW is the special case); device-local
    (sync-exclusion contract documented in code for future sync).
  - `apps/user-client/src/data/settings.ts` — `useAdultMode()` hook
    (`{ mode, toggleMode, setMode }`).
  - `apps/user-client/src/data/personas.ts` — `useFilteredPersonas()`
    composes `usePersonas()` + `useAdultMode()`. **Project guideline**:
    any UI that lists personas, counts them, or resolves a recent
    persona reference must use this hook; raw `usePersonas()` is for
    Editor-class persona-by-id lookups only.
  - `apps/user-client/src/components/AdultModeToggle.tsx` (new) —
    brand-bar pill, single-state with ⇄ glyph, click toggles, NSFW
    red-toned / SFW grey-toned, subtle shimmer.
  - `apps/user-client/src/components/PersonaCard.tsx` — new required
    `mindspace: ResolvedMindspace` prop. Card background tint =
    palette.surfaceBase at 10% opacity; base border = palette.accentBorder.
    NSFW vs SFW box-shadow ring + CSS shimmer streak. Per-card random
    shimmer delay (djb2 hash of persona.id mod 4 s). prefers-reduced-motion
    disables shimmer.
  - `apps/user-client/src/routes/root.tsx` — `<AdultModeToggle />`
    mounted between logo and connectivity badge; brand-bar uses
    `justify-between gap-2` for three-child distribution.
  - `apps/user-client/src/routes/app/circle.tsx` — `useFilteredPersonas()`;
    resolves mindspace per card via existing `resolveMindspace()`;
    empty-state copy unchanged (no-leak per spec §2 Decision 4).
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — `useFilteredPersonas()`
    for `personaCount` and `recentPersona` lookup. Continue-chat card
    naturally hides when recent persona is filtered out.
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mount-effect
    updates global `useMindspaceStore` with the loaded persona's
    mindspace context.
  - `apps/user-client/src/index.css` — new `.adult-mode-toggle*`,
    `.persona-card*`, `@keyframes pill-shimmer`, `@keyframes
    persona-shimmer`, reduced-motion overrides.
  - Tests: ~18 new Vitest cases across client-data-db v5 (2),
    use-adult-mode (3), use-filtered-personas (3), AdultModeToggle
    (4), persona-card (3 added), root.adult-mode-pill (1),
    circle.filter (3), entrance-hall.filter (3), persona-editor.mindspace
    (1). All 238 user-client tests pass across 57 files; llm-unified
    Bun tests untouched and green; `pnpm typecheck && pnpm lint && pnpm
    --filter user-client run build` clean.

- **Polish iteration 7 (2026-05-24)** — three follow-ups from Chris's
  iteration-7 smoke after Phase 2.9. One squashed commit (`86975d7`).
  - `apps/user-client/src/routes/app/circle.tsx` — Circle owns the
    user-default mindspace context. Mount-effect now resets the global
    mindspace store to `persona: null` so the Persona-Editor's
    persona-specific mindspace does not leak back when the user
    navigates back from editing.
  - `apps/user-client/src/routes/app/persona-editor.tsx` — mindspace-
    sync effect now depends on draft fields (`draft.mindspaceId`,
    `draft.textureOverride`) instead of `persona.data`. Picking a
    mindspace inside the editor updates the ambient background
    immediately — live preview without needing to Save.
  - `apps/user-client/src/components/PersonaCard.tsx` — card tint now
    uses `palette.accentSubtle` (a persona-specific 6% rgba of the
    mindspace accent) instead of `palette.surfaceBase + '1a'`. The
    8-hex-alpha suffix is not valid on an rgba string so the rule was
    silently ignored — cards had no visible mindspace tint until this
    fix. `accentSubtle` is already an rgba with the right opacity.

- **Polish iteration 8 (2026-05-24)** — two follow-ups from Chris's
  pre-deploy review of the persona surface. One squashed commit.
  - `apps/user-client/src/components/MindspaceTexture.tsx` — new
    optional `animationDelaySeconds` prop, propagated to each layer's
    inline `animation-delay`. Lets multiple texture instances on the
    same screen avoid synchronised drift. Grain variant ignores the
    prop (no animation).
  - `apps/user-client/src/components/PersonaCard.tsx` — each card now
    renders its persona's `MindspaceTexture` inside the rounded
    container (clipped by the existing `overflow: hidden` on
    `.persona-card`). Content layered above the texture via
    `relative z-[1]`; the shimmer `::after` keeps top z-stack via DOM
    order. Per-card texture-delay derived from a second djb2 hash
    window (`tx:<persona.id>` mod 8 s) so card textures and shimmers
    don't co-pulse. Fixes "all persona cards show the user-default
    texture, not the persona's own".
  - `apps/user-client/src/components/EditorTopbar.tsx` — full redesign.
    Hand-drawn SVG back arrow (24×24 viewBox, stroke 1.5, rounded
    caps) inside a 44×44 hit target. Title promoted from `<span>` at
    `text-sm` to `<h1>` at `text-lg lg:text-xl` in `font-display`
    (Lora) with `leading-none` so back arrow, title, and Save-pill
    sit on the same vertical centre line. No gradient on the title —
    same family as the brand wordmark but visually quieter. Save &
    Back button unchanged (border + uppercase + tracking) plus a
    `transition` on hover. `hideSaveAndBack` spacer kept.
  - `apps/user-client/src/routes/app/circle.tsx` — inline header
    replaced with `<EditorTopbar … hideSaveAndBack />` so Circle,
    Persona-Editor, My Settings, and My Account share one topbar
    surface.
  - `apps/user-client/tests/unit/persona-card.test.tsx` — one new
    Vitest case asserting the `.mindspace-texture` overlay renders
    inside the card with the persona's mindspace texture name. 240/240
    user-client tests green; llm-unified Bun tests untouched.

- **Phase 3.1 — Chat Backbone (2026-05-24, squashed at `6c2f9fa`)**.
  See the verbatim Phase-3.1 baseline at the top of this file for the
  full landed contents — `packages/llm-unified` extension (Reasoning
  + KnownModel + nano-gpt pair-map + helpers, 132 Bun tests),
  user-client chat backbone (Dexie v6, two new stores, stream-engine,
  TanStack hooks, full chat-component set, `/app/chat/new` and
  `/app/chat/:chatId` routes), 353 Vitest tests green.
- **Phase 3.2 — Background-Stream + Multi-Chat + NSFW Panic
  (2026-05-24, squashed at `fa4647f`)**. Hamburger-navigation during
  a live stream no longer aborts the engine — the stream-manager
  keeps the StreamHandle alive and the engine runs to completion in
  the background. New `BackgroundStreamBadge` in the brand-bar
  surfaces live streams (persona initial when one; counter when
  multiple) and routes back to the oldest on tap. Toast component +
  store added (queue, auto-dismiss, info/warn/success tones, polite
  aria-live), mounted globally next to SplashOverlay. NSFW Panic
  auto-kick: when the Adult-Mode pill flips nsfw → sfw while one or
  more adult-persona streams are alive, all matching handles
  `abortDiscard` (draft persona-message deleted, user-message
  preserved), and if the active chat is one of those personas the
  user is navigated to the Entrance Hall with a warn-toast "Adult
  mode off — chat closed". sfw → nsfw is a no-op for panic;
  previously filtered personas simply become visible again. Cockpit
  Send-disable subscribed to the stream-manager via the
  `isStreamLive` prop already plumbed through ChatPage in 3.1.
  367 Vitest tests pass across 83 files.
- **Phase 3.3 — Pills + Title-Gen + Partial-Recovery + Chat-route
  wire-up (2026-05-24, squashed at `d32f223`)**. Pill rendering
  verified end-to-end (`PillRow` → `ContentBlocks` → `MessageBlock`
  → `<Pill />` with correct ordering and kind metadata). ADR 0029
  ("Tool Display Position") landed; Phase 3 hardcodes `positionHint:
  'inline'` for tool-call pills, forthcoming Tool Registry populates
  from each tool's manifest. Title-Gen: `lib/title-generator` with
  `sanitiseTitle` (strip surrounding quotes, collapse whitespace,
  cap at 60 chars) and `fallbackTitle` ("New chat — D MMM, HH:mm",
  British convention). Fires asynchronously from the stream-manager
  after the first persona response, gated on `chat.title === null`
  and completed-persona-message count of exactly 1. Uses the active
  persona's provider + model AND composes the global unlocker into
  the system prompt (per `background-jobs-prompt-composition` memory
  rule). Partial-stream recovery: `StreamInterruptedFooter` renders
  below the last persona-message when its `streamingState ===
  'incomplete'`; Retry deletes both the incomplete and the prior
  user-message then re-sends via the normal send-flow; Discard
  deletes only the incomplete. Footer buttons disabled while another
  stream is live in the same chat. Chat-route wire-up: Circle
  persona-card's `Chat` button and Entrance-Hall Continue card were
  left as Phase-2-era no-ops when 3.1 landed; both now route — Circle
  to `/app/chat/new?personaId=<id>` (lazy), Continue card to
  `/app/chat/<recentChatId>`. Polish tasks 39 (affordance breathing,
  scroll-to-end micro-animation, pin glow) and 40 (per-card streaming
  indicator) deferred. 388 Vitest tests + 132 Bun tests green; full
  typecheck + lint + build clean.

- **Phase 3.3 polish-iteration 1 (2026-05-25 evening)** — single
  squashed commit on master following Chris's full-day device smoke.
  Roughly 25 distinct bugs across the chat surface, plus a dev DB-
  dump tool. Highlights:
  - **Provider URL build** — `ProviderRow.baseUrl` was written empty
    on upsert (Decision 22 only half-implemented), so `transport.ts`
    composed `'' + '/chat/completions'` and the browser resolved
    relative against the dev origin (404 against vite). Fixed by
    deriving `baseUrl` + `routing` from `ProviderDefinition` in
    `send-message.ts` (both `useSendMessage` and `useRegenerate`).
  - **Novita 400 on GLM 5.1** — `thinking: true` is a nano-gpt
    convention; Novita expects a struct `{ type: 'enabled' |
    'disabled' }` and 400d with *"cannot unmarshal bool into Go
    struct field …Thinking"*. Drop boolean `thinking` for non-nano-
    gpt providers in `stream-completion.buildBody`. Reasoning-OFF for
    Novita / Ollama-Cloud is a per-provider follow-up.
  - **Live streaming** — `onChunk` was a no-op with a "deferred to
    Phase 3.2" comment; `queryClient.invalidateQueries` was never
    called after the DB write completed. Both wired up. Plus: handle
    reference is rotated on every token (was mutated in place) so
    zustand selectors actually fire — without this rotation the
    stream appeared "all at once".
  - **Scroll anchoring through layout shifts** —`ChatStream` gained
    a `ResizeObserver` (with a polyfill in `tests/setup.ts` for
    jsdom 25) that locks scrollTop to scrollHeight on container
    resize when autoFollow is true. Bridges cockpit-open layout
    shifts, dynamic cockpit-textarea height, and stream completion.
    Plus: `stream-manager.then` now rotates handle reference on
    status transitions (`finalising`, `done`) so the post-completion
    auto-follow correction fires immediately rather than 200ms late.
  - **Cockpit restructure** — `.interaction-mode` switched to
    `display: contents` and `.cockpit` + `.interaction-topbar` became
    real flex-children of `.chat-page` (`order: -1` / `order: 1000`,
    `flex-shrink: 0`). `chat-stream` now genuinely shrinks for the
    cockpit instead of getting overlaid. Required follow-up: `.cockpit`
    and `.interaction-topbar` need `position: relative` for z-index
    to actually apply — without it, `.dim-overlay` (z-index 3) was
    silently rendering over the cockpit on focus.
  - **queryKey mismatch** — `chat-page.tsx` and `send-message.ts`
    invalidated `['chat', id]`, but `QK.chat()` returns `['chats',
    id]`. Three call-sites fixed; explains why Discard "did nothing"
    (DB row deleted but UI never refreshed).
  - **CockpitMenu (…) close** — outside-tap and Escape now close;
    selecting a reasoning chip also auto-closes.
  - **Outside-tap dual-action** — closing the cockpit by tapping a
    message no longer also expands that message. Implemented via a
    document-level click-capture listener attached inside the
    pointerdown handler (survives React unmount when the cockpit
    closes).
  - **StreamInterruptedFooter** — early-return when `isStreamLive` so
    the footer only appears for genuine recovery, not for in-flight
    streaming with `streamingState === 'incomplete'`.
  - **MessageBlock expand → scrollIntoView({ block: 'end' })** so
    controls don't render behind the cockpit edge.
  - **Newlines preserved** — `.msg-text { white-space: pre-wrap }`
    keeps user Shift-Enter structure and model paragraph breaks.
  - **Context-gauge** — `contextUtilisation` reports `1` as the
    smallest non-zero value so the 200k-context windows don't sit
    at 0% for the first few thousand tokens.
  - **BottomAffordance** — bumped breathing distance to `2rem +
    safe-area`; tap also calls `setAutoFollow(true)`; chat-stream
    reading-mode `padding-bottom: 4rem` so it doesn't overlap text.
  - **ScrollToEnd** — moved inside `ChatStream` as a sticky-bottom
    last child; always sits 1rem above the visible chat-stream
    bottom regardless of cockpit height.
  - **setInteractionMode(true)** also resets `expandedMessageId` —
    opening the cockpit clears stale expand state.
  - **Persona-editor quick-actions wired** — Continue + New Chat
    auto-save (if dirty) then navigate; Incognito stays disabled
    until Block 3. Continue uses `useChats` to find this persona's
    most-recent chat.
  - **predev hook** — `apps/user-client/package.json` `predev`
    auto-builds workspace packages (`pnpm --filter './packages/*'
    build`) so a fresh clone or a different-machine pull doesn't
    crash Vite on stale `dist/`. (Landed as `2db2721` earlier in
    the day.)
  - **Dev DB-dump** — new `/__dump-db` Vite middleware (dev-only
    via `apply: 'serve'`) writes posted IndexedDB JSON to
    `<repo>/dumps/db-<ISO-timestamp>.json`. Triggered from a new
    "Developer tools" accordion in My Account (DEV-only).
  - Hygiene: deleted `WIP-NEXT-SESSION.md` (obsolete since the
    onboarding squash), refreshed this STATUS file.
  - Test count: 379 passes / 9 fails. The 9 fails are pre-existing
    cockpit-draft jsdom localStorage cascade — confirmed unchanged
    before any session edits, tracked as the known-fragility item.

- **Phase 3.3 polish-iteration 2 (2026-05-25 late evening)** — single
  squashed commit on master following the cosmetic styling pass and
  mindspace/font binding overhaul that Chris briefed. What landed:
  - **BottomAffordance refactor** —
    `apps/user-client/src/index.css`. The handle is now a true flex-child
    of `.chat-page` (`order: 999`, `flex-shrink: 0`,
    `align-self: center`, `padding-bottom: 2rem + safe-area`) consistent
    with `.interaction-topbar` and `.cockpit` since Phase 3.3 iter 1.
    Two previous attempts (`position: absolute`, `position: fixed` with
    z-index) had Chris-observed scrolling — a flex-sibling structurally
    cannot scroll with another sibling's overflow. Also dropped
    `chat-page[data-mode="reading"] .chat-stream { padding-bottom: 4rem }`
    (now redundant — chat-stream shrinks for the affordance naturally).
  - **Affordance stays visible through scroll-up** —
    `apps/user-client/src/routes/app/chat/chat-page.tsx`. Render
    condition was `!isInteractionMode && hasMessages && autoFollowEnabled`;
    dropping the `autoFollowEnabled` gate fixes both Chris-observed
    issues: (a) "scrolls away" — really the unmount on autoFollow → false;
    (b) "scroll snaps back several times near the bottom" — the unmount
    grew chat-stream's clientHeight, ResizeObserver fired with a stale
    `autoFollowRef`, and snap-to-bottom executed. With the affordance
    persistent, no resize → no RO race.
  - **Message-label redesign** —
    `apps/user-client/src/components/chat/MessageBlock.tsx`,
    `apps/user-client/src/index.css`. ✨ prefix on persona name, 🪶 on
    user name (both `aria-hidden`, decorative). `.msg-name` font-size
    `0.75rem` → `0.95rem`, weight kept at 600, opacity bumped to 0.95.
    User name styled with
    `color-mix(in srgb, persona.colour 55%, var(--color-paper-soft) 45%)`
    — recognisably the persona accent but muted. `.msg-name` is now
    `inline-flex` with `gap: 0.4rem` to host the prefix span cleanly.
  - **Interaction-Topbar persona-name → editor** —
    `apps/user-client/src/components/chat/InteractionTopbar.tsx`,
    `InteractionMode.tsx`, `chat-page.tsx`,
    `routes/app/persona-editor.tsx`. The centre region ("Chat with" +
    name) is wrapped in a button with `aria-label`; tap navigates to
    `/app/persona/<id>?return=<current chat URL>`. PersonaEditor reads
    `?return=` via `useSearchParams` and honours it for both the back
    arrow and the Save & Back pill (default fallback unchanged at
    `/app/circle`). Delete-persona still navigates to `/app/circle`
    (the chat it would return to no longer exists). Optional
    `onOpenPersonaEditor?: () => void` prop on InteractionTopbar; the
    centre button is `disabled` when no callback (consumer-friendly
    default).
  - **ChatPage auto-scrolls to end on mount** — `chat-page.tsx`. The
    chatId-bound effect now also calls `setAutoFollow(true)` when
    entering chat-mode, so navigating back from the persona editor (or
    arriving from anywhere) lands the user at the latest message even
    if they had scrolled up before leaving. ChatStream's existing
    `[autoFollow, messages.length, streamHandle]` effect picks it up.
  - **ChatPage binds mindspace store to its persona** — `chat-page.tsx`.
    New `useEffect` parallel to PersonaEditor's: resolves
    `effectivePersona.mindspaceId` + `textureOverride` with the user
    default + texture from settings, and writes the result into the
    global mindspace store. Closes the previously-silent gap — chat
    surfaces showed whatever was last set elsewhere (Circle's user
    default, the editor's most-recent persona, etc.).
  - **Persona-font applies to message text** —
    `apps/user-client/src/components/chat/MessageBlock.tsx`. The
    `.msg-text` container receives `fontFamily: FONT_VAR[persona.font]`
    on both user AND persona messages (Chris's explicit choice — the
    chat surface speaks in the persona's voice end-to-end). Decision
    log: this is a deliberate widening of "persona voice = persona's
    typography" beyond just the persona's own utterances.
  - **Persona-editor topbar title in persona-font + colour** —
    `apps/user-client/src/components/EditorTopbar.tsx`,
    `routes/app/persona-editor.tsx`. New optional `titleStyle?:
    CSSProperties` prop on EditorTopbar. PersonaEditor passes
    `{ fontFamily: FONT_VAR[draft.font], color: draft.colour }` in
    edit-mode (gate: `!isCreate`). Live-preview when picking a different
    font in "Font and Voice" or a different mindspace accent in
    "Mindspace — Override". Create-mode left at the default topbar
    styling — title is the "New Persona" placeholder.
  - **Body aurora dimmed on `/app/<subroute>`** —
    `apps/user-client/src/routes/root.tsx`, `index.css`. New `useEffect`
    in Root toggles `body.dim-ambient` based on a regex `/^\/app\/.+/`.
    The dimmed CSS rule reduces gradient-stop opacities to `rgba(...0.3)`
    and `rgba(...0.25)` while preserving the gradient shape. Aurora
    stays at full strength on `/`, `/login*`, `/onboarding*`, exactly
    `/app` (Entrance Hall), `/change-passphrase`. Cleanup-on-unmount
    effect strips the class as defence against Root remounts.
  - **Shared `FONT_VAR` helper** —
    `apps/user-client/src/lib/persona-font.ts` (new). Deduplicates the
    same map between MessageBlock, PersonaGreeting, and PersonaEditor.
    All three import from here now.
  - Tests: 12 new Vitest cases — MessageBlock (4: prefix-on-user,
    prefix-on-persona, tinted user-name colour, font on both
    `.msg-text` variants), InteractionTopbar (2: centre-button click
    fires callback, disabled fallback when no callback),
    persona-editor.return-url (3: default `/app/circle` fallback, back
    honours `?return=`, Save & Back lands on `?return=` route). All
    386 user-client tests pass (was 379 before this iter); the 8
    failing tests are the same pre-existing localStorage cascade
    (down from 9 — one was already flipped). `pnpm typecheck && pnpm
    lint && pnpm --filter user-client run build` clean.

- **Phase 3.3 polish-iteration 3 (2026-05-25 night)** — single squashed
  commit on master following Chris's pre-Phase-4 micro-polish ask. Two
  styling items + one follow-up tweak. What landed:
  - **Cockpit-prompt font locked to sans-serif** —
    `apps/user-client/src/index.css`. `.cockpit-input` had
    `font-family: inherit`, which since iter-2 silently picked up the
    persona's display-font through `.msg-text` (the inheritance chain
    runs through `.chat-page → .cockpit → .cockpit-input`). Locked to
    `var(--font-sans)` (Inter) with a comment explaining the cockpit is
    a system surface, not a persona voice.
  - **Token fade-in while streaming** —
    `apps/user-client/src/state/stream-manager.store.ts`,
    `components/chat/ChatStream.tsx`, `components/chat/MessageBlock.tsx`,
    `index.css`. `appendTextBlock` no longer coalesces during live
    streaming — each upstream chunk becomes its own `{type:'text',text}`
    block. MessageBlock receives a new optional `isStreamingDraft?:
    boolean` prop (propagated from ChatStream's existing `isDraft`
    branch); when true, text-block spans get the `token-fade` class.
    New `@keyframes token-fade-in` (280 ms, opacity + 1.5 px blur → 0)
    with `prefers-reduced-motion` override. React mounts only the
    newly-arrived span on each token, so the keyframe plays exactly
    once per chunk — settled spans stay still. Persistence shape
    unchanged on the success path (final DB write still uses
    `result.finalContentBlocks` from the engine, which *does*
    coalesce). The catch/incomplete path persists the segmented buffer
    verbatim, which is safe because every downstream reader
    (`toWireMessage`, copy, StreamInterruptedFooter, context-gauge)
    already joins text blocks with `filter+map+join`.
  - **User-name label adopts persona font + deeper desaturation** —
    `apps/user-client/src/components/chat/MessageBlock.tsx`. Iter-2 set
    the persona-font on the persona name and on `.msg-text` for both
    roles but left the user-name label at the default font; the chat
    surface read inconsistently. User name now uses the same
    `FONT_VAR[persona.font]` as everything else. Accent share in the
    user-name `color-mix` dropped from 55% → 38% — the label sits
    further behind the persona name while still recognisably tinted by
    the persona's accent. Both name styles refactored to a shared
    `personaFont` local.
  - Tests: 2 new Vitest cases (MessageBlock `token-fade` class on/off
    by `isStreamingDraft`, stream-manager live-buffer pushes each
    chunk as a separate text block — no coalescing) + 1 existing
    user-name test extended to assert the persona font is now applied.
    All 388 user-client tests pass (was 386); same 8 pre-existing
    cockpit-draft localStorage cascade failures. `pnpm typecheck &&
    pnpm lint && pnpm --filter user-client run build` clean.

- **Pre-Phase-4 hotfix — NSFW Panic preserves draft (2026-05-25,
  squashed at `832aa79`)**. Phase 3.2's panic deleted the partial
  persona-draft on adult-mode flip (discard semantics). Corrected per
  the Phase-4 brainstorm to preserve: abort the stream, write the
  partial buffer back as `streamingState: 'incomplete'`, leave the row
  in place so StreamInterruptedFooter on re-visit can offer
  Retry/Discard. Added `abortAllForPersonaPreserve` next to the
  existing `abortAllForPersonaDiscard` (still used by user-initiated
  cockpit Stop). One new Vitest case covers the preserve contract
  (transition from `'complete'` to `'incomplete'` proves the Dexie
  write actually fired).

- **Phase 4 — CoT display + reasoning-OFF translation (2026-05-25,
  squashed at `3efc12b`)**. Chain-of-thought trace surfaces as a
  closed-by-default mindspace-tinted pill next to each persona-message
  that carries reasoning. Closed: three sequentially-pulsing dots
  (Animation A, locked during visual-companion brainstorm) + chevron;
  18 % accent saturation against ink. Open: body streams the trace in
  the persona font with `white-space: pre-wrap` (the explicit
  chatsune-blank-lines fix), 0.85rem font-size, 8 % saturation. Pill
  renders only when a trace exists (no empty stub). One pill per
  maximal adjacent-reasoning run; interleaved-thinking models produce
  multiple pills at time-correct positions in the chat surface
  (structural correctness — device verification deferred to Block 3
  with the tool-execution work). Local per-pill open/closed state,
  orthogonal to `expandedMessageId`. Reduced-motion overrides stop the
  dot pulse and chevron transition. Screen-reader gets a single
  `aria-live="polite"` "Model is thinking" hint while live.
  
  Wire-side: `ContentBlock` gains a third variant
  `{ type: 'reasoning'; text: string }` in `client-data-db.ts`
  (Dexie bumped to v7 as code-capability marker; schema-structurally
  identical to v6 since `contentBlocks` is non-indexed JSON).
  `StreamChunk` gains a `reasoning` variant; `streaming.ts` parser
  reads `delta.reasoning` (modern) + `delta.reasoning_content`
  (legacy) and yields reasoning before token in the same SSE event.
  New `_reasoning-body.ts` module owns per-provider Reasoning-OFF
  translation driven by a `ReasoningIntent` discriminated union:
  nano-gpt slug-swap (`pair.switchingMode === 'slug'`) vs flag-body
  (`{reasoning:{enabled,effort}}`), Novita unified
  `{reasoning:{enabled,effort}}`, Ollama-Cloud `{think:bool}`.
  `buildBody` in `stream-completion.ts` consumes `extras.reasoning`
  and delegates; the Phase-3.1 boolean `thinking` extras path is
  removed. `reasoning-resolver.ts` now emits
  `{ reasoning: ReasoningIntent }` for `kind: 'optional'` models and
  `{}` for `no_reasoning` / `always_on` (capability-gated UI ensures
  toggling is impossible in those cases anyway).
  
  Client-side: new `lib/content-blocks.ts` consolidates
  `flattenAnswerText` (filters reasoning, joins text, ignores pill),
  `coalesceAdjacent` (merges adjacent same-type, pill never merges),
  `groupAdjacent` (partitions into ordered runs of same-type blocks).
  `copyMessageText`, `toWireMessage`, and the renderer all read
  through these helpers — reasoning never crosses to clipboard, wire,
  or context-gauge. `stream-engine.ts` routes reasoning chunks via a
  new `appendReasoning` helper (coalesce-on-adjacent, mirrors
  `appendText`). `stream-manager.store.ts` `appendTextBlock` was
  renamed and generalised to `appendStreamChunk({kind, text})` and
  now mirrors both token AND reasoning chunks into the live buffer,
  preserving the non-coalescing contract from Phase 3.3 polish-iter 3
  so the token-fade keyframe plays once per chunk for reasoning
  spans too. `MessageBlock.renderBlocks` rewritten around
  `groupAdjacent`: text → span with persona-font + token-fade,
  reasoning → `<ReasoningPill>` (one per maximal run, last-of-message
  marked live while streaming), pill → existing `<Pill>` component.
  `ChatStream` wires mindspace via `useMindspaceStore`. Title-gen
  uses `runOneShotCompletion` (non-streaming) which structurally
  reads only `choices[0].message.content`, so reasoning-from-title is
  already prevented — no code change needed there.
  
  Tests: 23 new Bun cases (parser reasoning fields, eleven
  applyReasoningToBody grid cases, buildBody refactor), ~40 new
  Vitest cases (content-blocks helpers, stream-engine reasoning
  routing, stream-manager polymorph, reasoning-resolver intent shape,
  copy filter, message-block group rendering, reasoning-pill
  component, Dexie v7 migration), one end-to-end integration test
  mocking `streamCompletion` and exercising the full pipeline
  (stream-manager → ChatStream → MessageBlock → ReasoningPill;
  asserts pill live → static transition and the coalesced trace
  surfaces on click). Full suite: `pnpm --filter
  @chatsundere/llm-unified test` 172/172 pass; `pnpm --filter
  user-client test` 422 pass / 8 pre-existing cockpit-draft
  localStorage cascade. `pnpm typecheck && pnpm lint && pnpm --filter
  user-client run build` all clean.
  
  Spec: [`superpowers/specs/2026-05-25-phase-4-cot-display-design.md`](../superpowers/specs/2026-05-25-phase-4-cot-display-design.md).
  Plan: [`superpowers/plans/2026-05-25-phase-4-cot-display.md`](../superpowers/plans/2026-05-25-phase-4-cot-display.md).
  
  Follow-ups noted by reviewers during execution (non-blocking, for
  later polish): four sibling `filter(b => b.type === 'text')`
  duplicates in `chat-page`, `send-message`, etc. could be migrated
  to `flattenAnswerText` for further dedup; `one-shot-completion.ts`
  has a dormant legacy `extras.thinking` reference (dead via the
  only current caller `title-generator`, but a real divergence from
  `stream-completion.ts` once a future one-shot caller passes a
  `ReasoningIntent`); the stream-manager test-env setTimeout leak
  documented in Task 11 deserves a `vi.useFakeTimers()` pass; biome
  `useImportType`/`organizeImports` may reorder `ChatStream`'s
  `MINDSPACE_FALLBACK` declaration on next format.

- **Phase 4 simple-history (2026-05-26, 15 task-commits `f89fef2 →
  061b28e`, awaiting manual smoke + squash)**. The "simple My History
  page (no bookmarks yet)" Next-session item delivered as 15 sequential
  TDD-paired task-commits via subagent-driven-development. Plan
  Task 13 (Today/Yesterday/Earlier date-group headers) was prototyped
  and dropped per its own LOC budget (54 net new lines vs ~30 cap) —
  deferred to Phase 4.x; tests passed before revert, no design issue
  surfaced. What landed:
  - `apps/user-client/src/lib/chat-title.ts` (new) — `displayTitle(chat)`
    helper, single source of truth for the "real title or fallback"
    decision. Consumed by InteractionTopbar, HistoryRow, and (via
    follow-up) the Entrance-Hall continue-card.
  - `apps/user-client/src/lib/relative-time.ts` (new) —
    `relativeTimeLabel(ts, now)` returning "just now" / "Xm ago" /
    "Xh ago" / "D MMM" per spec §4.3.
  - `apps/user-client/src/lib/title-generator.ts` — TITLE_INSTRUCTION
    rewritten to the chatsune-style prompt (inline-NSFW-unlocker +
    "use the language of the conversation" instead of forced British
    English) AND exported. `generateTitleAsync` gained a race-guard:
    `db.chats.get` re-read immediately before both the success-path
    `db.chats.update({ title: cleaned })` and the catch-path
    `db.chats.update({ title: fallbackTitle(...) })`. If the user
    manually titled mid-call (`current?.title != null`), the writer
    bails out — no overwrite. No Dexie bump needed.
  - `apps/user-client/src/data/chats.ts` — new `useDeleteChat`
    mutation. Pre-step: `useStreamManagerStore.getState().abortDiscard(chatId)`
    (existing method, no-op when no stream). Then cascades pills →
    messages → chat row inside one Dexie `'rw'` transaction.
    Invalidates `QK.chats` on success.
  - `apps/user-client/src/components/chat/InteractionTopbar.tsx` —
    full centre-region rewrite. Props gain `chat: ChatRow | null`
    and `onRenameChat: (next: string | null) => void`. Centre is now
    a two-row stack: title row (with `🖎` pencil affordance) on top
    + persona-name row below. Tap on the title → swap to inline
    `<input>` (autofocus, `maxLength={60}`, controlled). Enter or
    Blur commit via `onRenameChat(sanitiseTitle(value))`; Escape
    cancels (`discardRef` guards the post-unmount blur). Lazy-mode
    (`chat === null`) shows a non-interactive `.topbar-title-placeholder`
    reading "New chat" — no pencil, no input. Persona-name row stays
    a separate tap-target. Old `.context-label` / `.context-name` /
    `.topbar-center-btn` CSS rules removed (confirmed unused elsewhere).
  - `apps/user-client/src/components/chat/InteractionMode.tsx` —
    forwards `chat` + `onRenameChat` from `ChatPage` into the Topbar.
  - `apps/user-client/src/routes/app/chat/chat-page.tsx` — derives
    `const chat = chatQuery.data?.chat ?? null`; new defensive
    `useEffect` navigates to `/app/history` (replace) when the
    chat row vanishes from another surface (`!isLazy && chatId &&
    chatQuery.isFetched && !chatQuery.data?.chat`). New `onRenameChat`
    callback wires to the existing `useUpdateChat` mutation.
  - `apps/user-client/src/components/history/` (new sub-folder, 5
    files): `HistorySearchBar` (controlled search input, live filter,
    no debounce), `PersonaFilterChips` (horizontal-scroll
    `[All]`-first chip row using persona accents), `HistoryRowRenameInput`
    (autofocused inline input, Enter/Esc/Blur semantics matching the
    Topbar), `HistoryRowConfirmTray` (inline confirm strip with 6s
    `setTimeout` auto-collapse), `HistoryRow` (assembled — title +
    persona-name + relative-time, trailing `🖎` and `🗑` icons, mode
    state-machine: `idle | rename | confirm-delete`).
  - `apps/user-client/src/routes/app/history.tsx` (new) — assembled
    `HistoryPage`. Reuses `useChats` (sorted `lastMessageAt` desc),
    `useFilteredPersonas` (the existing NSFW-aware hook drives both
    the chip row and row visibility — single source of truth), and
    `useAdultMode`. Local `searchQuery` + `filterPersonaId` state;
    `?personaId=` URL param mirrored both ways via `useSearchParams`.
    Auto-reset effect: when the selected `filterPersonaId` is no
    longer in `personas.data` (e.g. `nsfw → sfw` flip while an NSFW
    persona was selected), filter falls back to `null` (`All`) and
    the URL param is dropped. Mindspace reset-to-user-default on
    mount (matches Circle pattern). Empty-state component renders
    three constructive variants per spec §4.4: no chats at all
    (link to `/app/circle`), persona-filter has no matches (link to
    `/app/chat/new?personaId=…`), search miss (no action link).
  - `apps/user-client/src/App.tsx` — registers `/app/history` route.
  - `apps/user-client/src/routes/app/entrance-hall.tsx` — "My History"
    tile flipped from `disabled` to active, `to="/app/history"`, meta
    reads `${chats.data?.length ?? 0} chats`.
  - `apps/user-client/src/routes/app/persona-editor.tsx` — quick-actions
    grid switched from `grid-cols-3` to `grid-cols-2` (2×2 — matches
    the neurodivergent-audience 2×2-matrix guidance). Fourth button
    "History" navigates to `/app/history?personaId=<id>` after
    `persistDraft()` if dirty; disabled when this persona has no chats,
    with tooltip "No chats with this persona yet".
  - Tests: ~72 new Vitest cases across 12 new test files (chat-title,
    title-generator race-guard, data-chats useDeleteChat, interaction-
    topbar refactor + lazy-mode, interaction-mode plumbing, chat-page
    stale-chat + rename, history-search-bar, persona-filter-chips,
    history-row-confirm-tray, history-row-rename-input, relative-time,
    history-row, history-route, persona-editor history-button, app-
    routes, entrance-hall my-history-tile). User-client suite: 486
    pass / 8 fail (pre-existing cockpit-draft localStorage cascade,
    unchanged). `pnpm typecheck`, `pnpm lint`, `pnpm --filter
    user-client run build`, `pnpm --filter @chatsundere/llm-unified
    test` (172/172) all clean.
  - Spec: [`superpowers/specs/2026-05-26-phase-4-simple-history-design.md`](../superpowers/specs/2026-05-26-phase-4-simple-history-design.md).
  - Plan: [`superpowers/plans/2026-05-26-phase-4-simple-history.md`](../superpowers/plans/2026-05-26-phase-4-simple-history.md).

- **About — disclaimer + licences (2026-05-28, squashed at `d591128`)**.
  Single squashed commit on master replacing My Account → About's
  compact `dl` with three richer blocks: a Privacy & data handling
  disclosure (three paragraphs), a Third-party libraries disclosure
  (12 curated entries from a new `lib/third-party-licences.ts`
  module), and a flat licence-and-links footer linking to the
  FSF-hosted AGPL-3.0 text, the GitHub source, the Provider
  Integration Policy on `teaser.chatsundere.me/policy`, and the
  chatsune.me docs. Native `<details>` disclosures (no JS state, no
  `AccordionCard` nesting). ADR 0030 documents the FSF-link
  decision. `copy.settings.about.{versionLabel,licenceLabel,
  licenceValue,docsLabel,docsValue}` retired in favour of three
  subtrees (`privacy.*`, `thirdParty.*`, `licence.*`). 11 new Vitest
  cases on `account.about.test.tsx`. No dep changes, no Dexie bump,
  no Larissa (frontend-only). Spec:
  [`superpowers/specs/2026-05-28-about-disclaimer-licences-design.md`](../superpowers/specs/2026-05-28-about-disclaimer-licences-design.md).
  Plan:
  [`superpowers/plans/2026-05-28-about-disclaimer-licences.md`](../superpowers/plans/2026-05-28-about-disclaimer-licences.md).

- **Phase 4 polish-iter 1 — reasoning-pill click + layout (2026-05-26,
  squashed at `f8fa23c`)**. Two interaction bugs from Chris's smoke
  after the Phase-4 squash.
  - **Layout — text following the pill clung to its right edge.**
    `.reasoning-pill` and `.reasoning-pill-open` were `display:
    inline-flex`, so subsequent text in `.msg-text` flowed inline next
    to the pill instead of starting on a new paragraph. Switched both
    to `display: flex` with `width: fit-content` — block-level so the
    pill occupies its own line, content-sized so it keeps its pill
    look and doesn't stretch across the bubble. Also restores the
    effective `margin-block` (which only partly applied on inline-flex).
  - **Click — opening the pill activated the message.** The button's
    `onClick` bubbled to the `.msg` container's `onToggleExpand`, so
    a tap on the pill flipped the message into expanded mode (controls
    visible, `scrollIntoView` forced) on top of opening the trace.
    Added `e.stopPropagation()` to the pill button's handler so the
    open/close gesture is purely local to the pill. Inline comment
    documents this as the convention for any future clickable in-
    message affordance — message activation must come from a direct
    tap on the message itself, not from one of its pills.
  - 5/5 ReasoningPill + 16/16 MessageBlock Vitest cases green.

## Briefed, awaiting implementation

- **Phase 5 — Bookmarks tab + Setup-Hints** (gated on Lyra's wireframe
  + invited-alpha-tester feedback). The simple-history surface now
  covers list/search/rename/delete; Bookmarks is the second tab; Setup-
  Hints needs separate design once we see how invited testers actually
  encounter the empty provider/persona state.
- **Date-group headers in My History** (`Today / Yesterday / Earlier`)
  — prototyped during simple-history Task 13 and dropped per LOC budget.
  Phase 5 candidate when we have more room.

## Open design questions / blockers

- Lyra's wireframe for My History — still in flight; Settings,
  Circle, Persona-Editor have landed (2026-05-23 update of
  `chatsundere-prototype.html`).
- Final 7-Mindspace palette + 2–3 finalised textures — Lyra-led.
- Provider endpoint exact base-URLs and probe paths (nano-gpt, Novita,
  Ollama Cloud) — verified live during Phase 1 implementation.
- "Wider encryption-at-rest" (messages, personas, settings) — Chris
  flagged this is a bigger-group conversation, not a Block 1 decision.
- ADR "Tool Display Position" — drafted during Phase 3 implementation.

---

## Doing now

*(between sessions — curation phase)*

Phase 4 alpha-prep landed across 15 sequential commits on master
(`76c333e → 9eb83b4`) plus follow-ups `88b7067` / `7536037`, and is
**pushed to `origin/master` unsquashed**. The originally-planned
squash + `v0.0.1` tag + Pages-source flip was **never executed** —
work continued straight into provider/model curation instead. Decided
with Chris on 2026-05-31: the squash is **abandoned** (the commits are
pushed and buried under 60+ later commits; a rewrite has no value), and
the **alpha release ceremony (v0.0.1 tag + Pages flip + alpha deploy at
`teaser.chatsundere.me/alpha/`) is deferred into the forthcoming
4-week roadmap** (alpha-tester invitations live there). The alpha is
therefore **not yet deployed**.

Since alpha-prep, the active work has been **curation**: 6 providers
onboarded/curated (chutes, nano-gpt, novita, wafer, tensorix, …) with
the conversation-suite as the verification harness. Latest: Tensorix
(5 EU-sovereign ZDR offerings) — see the Last-updated header above.

**Retry observability — done** (commit `7402231`, 2026-05-31). Added a
sink-agnostic `onRetry` hook + pure `formatRetryEvent` to
`packages/llm-unified/src/retry.ts` (stays dependency-free) and a new
`withStreamingRetry` helper that consolidates the two hand-rolled
streaming loops. Structured `console` sinks wired at all three
call-sites (stream-completion, one-shot/title-gen, suite binding) —
transient 5xx/429s are no longer invisible at the retry layer.
**Bonus:** the refactor killed a latent `ERR_BODY_ALREADY_USED` bug that
existed in stream-completion AND one-shot (Request built once then
reused on retry; both retry paths were silently broken — masked by tests
whose mocks never read the body; binding was the only site fixed, in
`3c0642d`). one-shot also gained a 30s overall timeout. Subagent-driven
TDD across 8 tasks, each spec+quality-reviewed; 192 tests green,
typecheck clean. prom-client metrics half deferred to the Phase-2 proxy
([[insights/follow-ups-index]]). Per [[insights/2026-05-31-retry-helper-brief]]
+ spec `superpowers/specs/2026-05-31-retry-observability-design.md`.

Next: **roadmap discussion** with Chris (clear 4-week picture in hand:
ship a chat client people already enjoy — not every feature, but
something that delights and doesn't annoy).

---

## Next session

1. **Retry observability** — the only concrete pre-roadmap
   implementation item. Wire an `onRetry`/logging seam into
   `packages/llm-unified/src/retry.ts` and its three call-sites
   (`stream-completion`, `one-shot-completion`, suite `binding`) so
   transient 5xx/429s stop failing silently (today's Tensorix
   timeouts were invisible at the retry layer). Logging half is doable
   immediately; metrics half + loop consolidation hang on the
   client-sink design question. Full brief:
   [[insights/2026-05-31-retry-helper-brief]].
2. **Roadmap discussion** — Chris has a clear 4-week picture: ship a
   chat client people already enjoy (not every feature, but something
   that delights and doesn't annoy). Sequence the items below against
   that goal.

**Deferred into the 4-week roadmap (was the abandoned alpha ceremony):**

- **Alpha release** — `v0.0.1` tag, one-time Pages-source flip
  ("Deploy from a branch" → "GitHub Actions" at
  `github.com/symphonic-navigator/chatsundere/settings/pages`), verify
  the deploy at `teaser.chatsundere.me/alpha/`, then invite the first
  testers ("ausgewählt, technisch sehr affine User" who don't need
  Setup-Hints). Re-sequence as a roadmap milestone.
- **Manual smoke of alpha-prep** — spec §7 items 1-10 on a real
  device (retry under transient 5xx, retry-on-abort cleanup, affordance
  breathing + scroll-to-end + pin glow, per-card streaming orb,
  reduced-motion respect). Fold into the alpha milestone.
- **Phase 5 (Bookmarks + Setup-Hints)** — gated on Lyra's wireframe +
  first-tester feedback. Date-group headers (dropped in Task 13) revisit
  here.

**Known follow-ups (non-blocking):**

- Cockpit-draft localStorage tests (8 failures) — pre-existing jsdom
  cascade; investigate test-env setup separately.
- Migrate four sibling `filter(b => b.type === 'text').map+join`
  duplicates in `chat-page.tsx`, `data/send-message.ts`,
  `state/stream-manager.store.ts` to call `flattenAnswerText` from
  `lib/content-blocks.ts` so the helper is the single source of
  truth across the codebase.
- Port the dormant `extras.thinking` reference in
  `packages/llm-unified/src/one-shot-completion.ts` to consume the
  new `ReasoningIntent` shape via `applyReasoningToBody` — currently
  dead via the only caller (title-generator), but a divergence from
  `stream-completion.ts` that future one-shot callers would trip
  over.
- Stream-manager-store test-env setTimeout leak (deletes handles
  200 ms after a successful stream test ends, sometimes wiping a
  handle that a later test created with the same chat-id) — fix
  with `vi.useFakeTimers()` or a teardown-aware delete.
- `MINDSPACE_FALLBACK` in `ChatStream.tsx` is currently
  `{} as ResolvedMindspace` — load-bearing because `ReasoningPill`
  currently `void`s the prop. Will NPE if a future consumer reads
  `mindspace.accent` etc. without the store populated first.
- ~~Port chatsune's `_retry.py` to a TS retry helper for
  `stream-completion`~~ **Done** — `packages/llm-unified/src/retry.ts`
  is the full port (low-level `shouldRetryStatus`/`computeRetryDelay`/
  `parseRetryAfter` + high-level `withRetry<T>`), wired into
  `stream-completion`, `one-shot-completion` (background path, e.g.
  title-gen), and the suite `binding`. **What remains** (not the port):
  make retries *observable* (the helper logs/counts nothing — chatsune's
  did; CLAUDE.md §6), consolidate the two inline loops, and lock the
  "background calls go through `withRetry`/`runOneShotCompletion`, never
  bare `fetch`" convention so memory-extraction etc. inherit it. Brief:
  [[insights/2026-05-31-retry-helper-brief]].

---

## Pointers

- Server-coupled work: [[STATUS-BACKEND]]
- Block 1 design spec: [`superpowers/specs/2026-05-23-client-block-1-design.md`](../superpowers/specs/2026-05-23-client-block-1-design.md)
- UX concept (Chris + Lyra): [`UX-CONCEPT.md`](../UX-CONCEPT.md)
- Visual ground truth (interactive wireframe): [`chatsundere-prototype.html`](../chatsundere-prototype.html)
- All open todos: [[insights/follow-ups-index]]
- Decisions: `decisions/0001–0028` (plus Block-1 Decisions 17–28 in
  the Block-1 design spec linked above — these are the Phase-2
  brainstorm decisions; promoted ADRs may follow)
- Design briefs: `briefs/phase 0/`
- Session journal: `insights/YYYY-MM-DD-*.md`
- Recent commits: `git log --oneline -20`
