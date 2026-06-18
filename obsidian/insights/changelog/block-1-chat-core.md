# Changelog — Block 1 · Chat core

> Archived from `STATUS-CLIENT-ONLY.md` on 2026-06-18 (STATUS reorg).
> Reverse-chronological. Chapter index: [[README]].


## Session log

**Earlier 2026-06-12 (late night) — MODEL INSTRUCTIONS LANDED**
(squash `b59d546` on master, **NOT pushed**; **DEVICE-CONFIRMED by Chris
2026-06-12** — Mistral itself, asked about the change, replied: "Ist besser so,
Shakespeare hat ja auch nicht 'To be or not to be' in Sperrschrift
geschrieben.").
Curated per-model prompt steering: `CanonicalModel.modelInstructions?` (Valibot
gate extended), a new Band-1 segment **after TEAL, before roleplay** (the
roleplay → persona adjacency untouched; persona instructions still override),
jobs **chat + greeting** only. Resolution via the new
`resolveModelInstructions(offering)` helper at all three `buildPrompt` call
sites (stream-engine, title-generator, chat-page context gauge — counts the
segment automatically). First use: the shared `MISTRAL_FORMATTING_INSTRUCTIONS`
constant on all three Mistral canonicals — prose over bullet-synopses for
stories, no spaced-out/ALL-CAPS emphasis (acronyms fine), restrains typography
never expression (Chris-approved wording). No UI, no toggle, no Dexie change;
not a Larissa path (client-only, no new egress), not a Laura path (no
flow/state change). Built **inline** (Chris's call). Gates: `pnpm typecheck
--force` **14/14**; llm-unified `bun test` **380/0** (+8 new); user-client
vitest **1602 pass / 8 fail** (the unchanged Node-26-localStorage baseline);
`pnpm run build --force` **9/9**; biome clean. The three Mistral Curation
Records carry a "Model instructions" section. Spec/plan:
[[../../../superpowers/specs/2026-06-12-model-instructions-design]],
[[../../../superpowers/plans/2026-06-12-model-instructions]]. **Device test (spec §6,
six steps; restart `pnpm dev` — packages/llm-unified changed):** Mistral story
→ prose not bullets; no SPERRSCHRIFT/CAPS emphasis; explicit table request
still yields a table; greeting opener as prose; GLM 5 unchanged; TTS read-aloud
flows. **Next:** Chris device-tests this AND the xAI voice onboarding below →
Liz pushes the master backlog on his word; then **Spec 3 (live voice)**.
**Earlier 2026-06-08 (chat-polish) — Chat polish: cancel inference, table
overflow, read-only home** (squashed onto master `cfe6923`, **NOT pushed**;
**NOT yet device-verified**). One client-only feature unit bundling three chat-surface
polish items Chris hit during device testing, brainstormed end-to-end with Chris,
built **subagent-driven** in an isolated worktree (7 TDD tasks + a stale-test fix +
a Critical fix; per-task spec+quality review + a final **opus** holistic review).
**(B) Cancel a running inference:** the whole abort machinery already existed
(`AbortController` threaded to the adapters; `abortDiscard`/`abortAllForPersonaPreserve`);
only a user control was missing. New **`abortPreserve(chatId)`** store action aborts a
single chat's live stream and **keeps the partial answer as `incomplete`** (vs
`abortDiscard`, which deletes a fresh-send draft) — Chris's call: the user decides
whether to keep what they have or retry. The **send button becomes a Stop control**
(square icon) while `isStreamLive` (`DualActionBtn`); `onStop` threads
chat-page → InteractionMode → Cockpit → DualActionBtn and calls `abortPreserve`. The
existing **`StreamInterruptedFooter`** then offers Retry, and the input frees
immediately so the user can just keep chatting. `abortAllForPersonaPreserve` now
delegates to `abortPreserve` (DRY). **No reading-mode Stop** (cockpit is one tap away —
Chris's call to keep reading mode minimal). **(C) Table overflow:** wide Markdown GFM
tables forced a page-level horizontal scrollbar (`.msg-text table` had no overflow
handling, unlike `pre`/`katex-display`). A `table` override in `markdown-components.tsx`
wraps tables in **`.msg-table-wrap` (`overflow-x:auto; max-width:100%`)** + a
`min-width:0` guard on `.msg-text`, so a wide table scrolls **inside its bubble**
(`.chat-stream` is `flex-direction:column` with `overflow-y:auto` → its `overflow-x`
computes to `auto`, the leak path). **(D) Read-only home logo:** the brand logo was
hidden in reading mode; it now always renders, gaining a small **`brand-logo-small`**
variant (twinkle dropped) in reading mode, linking `to="/"` (→ Entrance Hall) for a
one-tap route home. Styling deliberately minimal (Chris does the precise pass).
**The opus holistic review caught one Critical the per-task reviews + Liz's own Task-1
reasoning missed:** `abortPreserve` wrote the partial to Dexie but did **not** invalidate
the chat query — and the message list is a **one-shot TanStack `useChat`** (not a Dexie
live-query; `chat-page.tsx:367`), so once the handle was removed the kept answer would
flash to an **empty bubble** until a later incidental refetch. Fixed by mirroring the
success/`.catch` paths (`invalidateQueries(['chats', chatId])` + `['chats']`), with the
store test strengthened to assert the invalidation. (Liz had **wrongly declined** this as
a Task-1 "minor", assuming Dexie reactivity that doesn't exist here — the holistic review
earned its keep.) **Not a Larissa change** (client-only; no auth/sync/proxy/crypto, no new
egress, no Dexie migration). Verification (on master after squash): `pnpm typecheck
--force` **14/14**; user-client vitest **8 fail / 1215 pass** — the **8 fail are the exact
unchanged `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline, verified
identical on master (8 fail / 1210 pass)**, +5 new green tests, **zero new failures** (one
transient 9th-failure flake observed once under parallel load, not reproduced in 3
subsequent full runs nor in the changed store test run 23/23 ×3); `pnpm run build`
**9/9**; biome clean on the changed files (the lone `index.css` `picker-backdrop`
format issue is **pre-existing on master**, untouched here). Full-tree capture verified
(`git diff master..chat-polish` empty over 18 files) + typecheck on master before worktree
cleanup. Spec/plan:
[[../../../superpowers/specs/2026-06-08-chat-polish-cancel-table-readonly-home-design]],
[[../../../superpowers/plans/2026-06-08-chat-polish-cancel-table-readonly-home]]. **Deferred
(logged, both Minor):** a rare cold-start-into-reading-mode splash-FLIP oddity, and a
Stop during the substitute-vision describe phase not cancelling the in-flight one-shot
([[insights/follow-ups-index]]). **Device test:** (1) send a message; while it streams
the send button shows a **stop** icon → tap → the stream halts, the partial answer
**stays** with a Retry footer (not blank), the input is usable; then type+send a new
message (continues), and on a fresh attempt tap **Retry** (re-rolls). (2) Regenerate a
reply, stop mid-stream → partial preserved with Retry, original not lost. (3) Receive a
Markdown table wider than 380px → it **scrolls horizontally inside its bubble**, the chat
stream shows **no** page-level horizontal scrollbar; code blocks/maths still scroll. (4)
In a chat, drop to reading mode (cockpit hidden) → a **small Chatsundere logo** appears
top-left → tap → lands in the Entrance Hall; interaction-mode logo unchanged. **Next:**
Chris device-tests → **Liz pushes the master backlog on his word** (Liz must NOT push).
**Earlier 2026-06-08 — Reusable model-picker landed**
(squashed onto master, **NOT pushed**; **NOT yet device-verified** — Chris chose to
land it before the device test, so the device checklist is still outstanding). One
**`ModelPickerField`** (trigger button) + animated **`ModelPickerModal`**
(bottom-sheet, two-step: **family-grouped, searchable** model list → provider list;
single-tap provider selects & closes; "always show step 2" even for single-provider)
now replaces all **three** model-selection surfaces — persona editor (was inline
two-tier list), substitute-vision setting and ask-expert setting (were native
`<select>`s). Stored formats unchanged. Brainstormed end-to-end with Chris (his
calls: two-step drill, family grouping + name-only search, single-click-closes);
built **subagent-driven** (8 tasks, per-task spec+quality review + a final **opus**
holistic review). Review caught & fixed: a **constructive-stale regression** (the
field now names a provider to add, honouring the *dere* value) + a **modal-close
wedge** (timeout fallback so a reduced-motion-disabled animation can't strand the
sheet) + an **honest persona-stale** (no masquerading an unchosen provider). Pure
logic unit-tested (**`buildPickerData`** family-grouping/search/capability-filter +
a field stale-state guard); UX **still to be device-verified**. Obsolete `<select>`
DOM tests removed. **Not a Larissa change** (client-only; no auth/sync/proxy/crypto).
Full typecheck green; user-client suite at the **master baseline** (only 8
**pre-existing** failures in cockpit-draft/chat-page/chat-route — unrelated). Merged
onto the lore-cooldown master cleanly (code is disjoint; only this STATUS file
overlapped). Touched only `apps/user-client`; **no Dexie**. Spec
`superpowers/specs/2026-06-08-model-picker-modal-design.md`, plan
`superpowers/plans/2026-06-08-model-picker-modal.md`. **Follow-up (`a12d846`):** the
model picker now lives in the persona **Identity** block (order avatar → name →
tagline → model), no longer its own accordion — Chris's polish ask; structure tests
updated.
**Earlier 2026-06-04 — Pinned-cockpit interaction tweaks landed (on
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
build clean. Spec/plan: [[../../../superpowers/specs/2026-06-02-persona-settings-design]],
[[../../../superpowers/plans/2026-06-02-persona-settings]]. **Deferred:** the whole
image-attachment subsystem (upload/paste/drag-drop, attachment storage, a message
image block, multimodal wire injection, thumbnails) + Feature 3's real behaviour;
a per-model tokeniser (truncation keeps the 4-chars heuristic). **Next:** Chris
device-tests the 6 manual steps (spec §9); bug-hunting happens on master.
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
Spec/plan: [[../../../superpowers/specs/2026-06-01-system-prompt-builder-design]],
[[../../../superpowers/plans/2026-06-01-system-prompt-builder]]. **Deferred** (spec §9):
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
[[../../../superpowers/specs/2026-06-01-session-branching-design]],
[[../../../superpowers/plans/2026-06-01-session-branching]]. **Next:** Chris
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
[[../../../superpowers/specs/2026-06-01-message-rendering-design]],
[[../../../superpowers/plans/2026-06-01-message-rendering]]. Deferred follow-ups:
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
Spec/plan: [[../../../superpowers/specs/2026-06-01-bookmarks-and-toc-design]],
[[../../../superpowers/plans/2026-06-01-bookmarks-and-toc]]. **Next:** Chris device-tests
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
[[../../../superpowers/specs/2026-06-01-credential-bus-design]],
[[../../../superpowers/plans/2026-06-01-credential-bus]],
[ADR 0033](../../decisions/0033-credential-bus.md). **Next:** Chris pushes the master
backlog when ready (now 10 commits ahead of origin); then Block-1 memory
(chatsune port) per [[ROADMAP]].
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
test).** Spec/plan: [[../../../superpowers/specs/2026-05-31-provider-model-handling-rework-design]]
/ [[../../../superpowers/plans/2026-05-31-provider-model-handling-rework]]. What
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
