# Plan — A sense of time, chat export, reduce animations

**Spec:** [`superpowers/specs/2026-11-18-time-export-motion-design.md`](../specs/2026-11-18-time-export-motion-design.md), approved by Chris on 2026-11-18 with every question as recommended.
**Branch:** `feat/050-time-export-motion` · **Execution:** subagent-driven. Units A, B and C are disjoint and run in parallel worktrees; I integrate their commits on the branch.

Rules for every implementer: British English everywhere; strict TypeScript, no `any` without a comment; one-line JSDoc on every exported function; comments explain *why*; test-first where the task says so; Biome-clean (`pnpm exec biome check <files>`). Never merge, push or switch branches; commit in your own worktree only, message imperative and capitalised, ending with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Visible secondary text for every disabled reason and helper, never a `title` tooltip (Laura S-C2). Stay out of `obsidian/STATUS-*.md`, `obsidian/insights/follow-ups-index.md`, `superpowers/open-items.md`, `CHANGELOG.md`.

Gates per unit before hand-back: the touched packages' `test` and `typecheck`; at the end, all of `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm lint`.

---

## Unit A — A sense of time (`packages/llm-unified`, `apps/user-client`)

**A-1. Stamp and gap formatters (llm-unified), test-first.**
- New `src/time-stamp.ts`, exported from `index.ts`: `formatSentStamp(createdAt: number, utcOffsetMinutes: number): string` → `<sent>Wed 18 Nov 2026, 21:14</sent>`; `formatGreetingNow(now, utcOffsetMinutes)` → `Saturday, 21 November 2026, 09:02`; `formatAwayGap(ms): string | null` (null under one hour; whole hours under a day; days under 14 days; weeks under 60 days; then months; singular/plural).
- Render rule exactly as spec A1: `new Date(createdAt + offset * 60_000)` with `getUTC*` getters and constant name tables. No `Intl`, no `toLocale*`.
- Tests: pinned strings for fixed instants (a negative offset, +05:45, a DST-boundary instant rendered with the offset stored for it, midnight, single-digit day), and `formatAwayGap` boundaries.

**A-2. The `time` segment (llm-unified), test-first.**
- `BuildPromptInputs.time?: { mode: 'chat' } | { mode: 'greeting'; now: number; utcOffsetMinutes: number; lastInteractionAt?: number }`.
- Segment `time`, band 3, order 2, jobs `['chat', 'greeting']`. Chat: the static text of spec A3 verbatim (export it as `TIME_STAMP_INSTRUCTION`). Greeting: `It is {formatGreetingNow} in the user's local time.` plus ` They last talked with you {gap} ago.` when `lastInteractionAt` is set and `formatAwayGap` is non-null. Absent `time` ⇒ empty.
- Tests in `composition.test.ts`: absent ⇒ no segment; chat ⇒ exact static text, identical across two calls at different `Date.now()`; greeting with and without gap; not present for `title`, `memory`, `tool-summary`.

**A-3. Data: offset, persona field, branch copies (user-client), test-first for the seedRole part.**
- `MessageRow.utcOffsetMinutes?: number` (JSDoc: written once at send, never changed, synced; absent on pre-0.5.0 rows). `PersonaRow.timeAwareness?: boolean` (absent ⇒ `!roleplay`). Non-indexed, no Dexie bump.
- `lib/time-awareness.ts`: `resolveTimeAwareness(persona): boolean`; `messageOffsetMinutes(m): number` (stored value, else `-new Date(m.createdAt).getTimezoneOffset()`).
- `state/stream-manager.store.ts` `start`: the new user row stores `utcOffsetMinutes: -new Date(now).getTimezoneOffset()`.
- **seedRole first:** write a test that branches a seeded chat through each branch path (`data/chats.ts` `useBranchChat`, `data/message-edit.ts` edit-branch) and asserts the branched greeting keeps `seedRole: 'greeting'`, is excluded by `isContextMessage` and found by `resolveOpenerContext`. Confirm it fails. Then copy `seedRole` and `utcOffsetMinutes` in both paths; add assertions for the offset. If the test does not fail before the fix, stop and report it instead.
- Check `sync/strip.ts`: messages and personas use deny-list polarity, so both new fields sync with no change; add a one-line test asserting `stripForSeal('messages', …)` keeps `utcOffsetMinutes`.

**A-4. Stamping the wire (user-client), test-first.**
- `lib/stream-engine.ts`: `StartStreamArgs` gains `userMessageAt?: { createdAt: number; utcOffsetMinutes: number }`. When `resolveTimeAwareness(persona)` and job `chat`: pass `time: { mode: 'chat' }` to `buildPrompt`, and stamp in `buildEngineWireMessages` (new optional `stamp` parameter) every `role: 'user'` message whose row has `kind !== 'seed'`, the active turn included. Stamping applies to the output of `replayHistory` row by row, so the implementer maps rows to their wire messages (user rows map 1:1 today; keep it that way and assert it). String content → `stamp + '\n' + text`; array content → `[{ type: 'text', text: stamp }, ...parts]`.
- Greeting (`stream-manager.store.ts` opener path, around `job: 'greeting'`): when resolved on, `time: { mode: 'greeting', now, utcOffsetMinutes, lastInteractionAt: persona.lastInteractionAt }`.
- Callers: every `start`/`regenerate`/edit-replace path that runs a chat turn passes the active user row's `createdAt` and `messageOffsetMinutes(row)`; regenerate uses the stored user row. Find them all via `runStreamEngine(` and `runIntoDraft(`.
- **Cache tests** (spec, *The test*): build turn N, append a persona reply and a new user row, build turn N+1, assert `JSON.stringify` of each message of turn N equals the same index in N+1; repeat with `process.env.TZ` changed between builds (rows carry offsets) and with a mocked `navigator.language`; after a simulated regenerate; for a branched copy's rows. Plus: seed body rows unstamped; switch off ⇒ no `<sent` anywhere and no segment; multimodal turn gets the leading part.
- **Other jobs test:** with time on, assert the inputs built by title generation (`lib/title-generator.ts`), memory extraction, compaction (`compaction/runner.ts` and its prompt), tool summary (`lib/tool-summary.ts`), ask-expert and the artefact author contain no `<sent`. Find the builders; if one routes through `buildEngineWireMessages`, it must not pass `stamp`.

**A-5. Token accounting (user-client).**
- `estimateReplayTokens` gains an optional `stamped` flag adding `estimateTokens(formatSentStamp(...))` for stamped user rows; the overflow failsafe in `start` and the chat page's gauge (`routes/app/chat/chat-page.tsx`, the `buildPrompt` mirror) pass the resolved switch and include the segment. Test: with time on, the gauge estimate equals `wireTokens` of the built messages for a fixture chat.

**A-6. UI (user-client).**
- `routes/app/persona/model-behaviour.tsx`: switch "Knows the date and time" (same toggle pattern as the page's existing switches, `aria-pressed`), writes `timeAwareness`. Visible helper lines exactly as spec A5 (privacy line always; the "timeless" line when roleplay and unset).
- `routes/app/persona/roleplay.tsx`: under the Roleplay switch, while roleplay is on and `timeAwareness` is unset, the line "Roleplay characters don't know the date and time. Change it under Model behaviour." with *Model behaviour* as a link to `/app/persona/{id}/model`.
- `lib/persona-hub.ts` `modelBehaviourMeta`: append ` · Timeless` when resolved off. Update its tests.
- Component tests for the switch and both lines.

---

## Unit B — Export a chat as Markdown (`apps/user-client`)

**B-1. `lib/chat-export.ts`, test-first.** Pure `chatToMarkdown(input)` where `input` holds the chat, persona name, user display name, messages (sorted), pills by id, attachments by message id, `exportedAt`, and `streamingMessageId?: string | null`. Output exactly as spec B2: front matter, `# title`, day headings `## Saturday, 14 November 2026`, `**Name** · HH:MM`, bodies through `displayPlainText(flattenAnswerText(...))`, tool lines `*[Used tool: name]*` (display name when the tool registry has one), `*[Image: name]*` / `*[File: name]*` / `*[Generated image]*`, `*[Reply interrupted]*`, the in-progress ending, reasoning omitted, kb-injection and voice-expression pills omitted, untitled title `Chat with {persona}`. Dates and times in the device's local time via fixed English names (reuse the A-1 style tables locally; do not import from Unit A to keep units independent). Also `chatExportFileName(persona, title, startedAt)` with a diacritic-folding slug (`normalize('NFKD')` then strip marks), `chat` fallback, untitled form `{persona}-chat-{date}`. Tests cover every rule above, TEAL moods and sounds, code blocks left literal, umlaut names.

**B-2. Delivery, `lib/share-or-download.ts`, test-first.** `deliverFile(file, title): Promise<'shared' | 'downloaded' | 'cancelled'>`, synchronous up to the `navigator.share` call: coarse pointer (`matchMedia('(pointer: coarse)')`) and `navigator.canShare({ files: [file] })` (try `text/markdown`, then a `text/plain` copy) ⇒ `share`; `AbortError` ⇒ `'cancelled'`; any other error or no share ⇒ `triggerDownload`. Tests with stubbed `navigator`.

**B-3. Quick-menu entry.** `components/chat/ChatQuickMenu.tsx`: new group between the persona group and *Image settings* with *Export chat*. Props: `exportState: 'empty' | 'preparing' | 'ready' | 'streaming'` and `onExport: () => void`. Notes as spec B1. The menu's host (find where `ChatQuickMenu` is rendered, likely `routes/root.tsx` or `chat-page.tsx`) loads messages, pills and attachment metadata when the menu opens (TanStack Query keyed on the chat), builds the file synchronously on tap, calls `deliverFile`, then toasts "Chat exported" on download, nothing on share or cancel, "Couldn't export this chat" on failure (tone `warn`). Keep the edit to `ChatQuickMenu.tsx` to the new group and its two props: a parallel session is editing this file.
- Tests: the entry's four states and notes; tap calls `onExport`; host test for the toast paths.

---

## Unit C — Reduce animations (`apps/user-client`, `packages/ui-shared`)

**C-1. The Vite CSS plugin, test-first.** `apps/user-client/build/reduced-motion-mirror.ts` exporting `mirrorReducedMotion(css: string, file: string): string` and the plugin `reducedMotionMirror()` (`enforce: 'pre'`, `transform` only for ids ending `/src/index.css`, active in serve and build). Parse with `postcss` (add it as a dev dependency of user-client with `pnpm add -D postcss --filter @chatsundere/user-client` if not already resolvable; prefer an already-present version). Rules as spec C2: mirror each rule of a `reduce` block right after the block under `:where(:root[data-motion='reduced'])` prefixed to every selector of the list; narrow every rule of a `no-preference` block in place with `:where(:root:not([data-motion='reduced']))`; keyframes inside either block are kept as they are, but a `reduce` block whose keyframes have no selector rule naming that animation's users must be fixed in `index.css` (see C-2); a nested at-rule other than `@keyframes`, or a parse error, throws `Error('<file>:<line>: …')`. Wire it in `vite.config.ts` before `tailwindcss()`.
- Tests: mirror and narrow on small fixtures; selector lists; source order; each loud-failure case throws with the line; and the real `src/index.css` transforms without error and every reduce rule has its twin.

**C-2. `index.css` keyframe-only blocks.** For `wizard-step-in` and `badge-pulse` (and any other block C-1's check flags), add inside the same reduce block a selector rule with the equivalent static result for the elements that use them. Smallest possible edit; nothing else in `index.css` changes.

**C-3. One signal.**
- `packages/ui-shared` `motion.respectsReducedMotion()`: also true when `document.documentElement.dataset.motion === 'reduced'`. Test.
- `apps/user-client/src/lib/reduced-motion.ts`: `prefersReducedMotion()` (same rule), `useReducedMotion()` (subscribes to the media query `change` event and to attribute changes via a small store or `MutationObserver`), `useSystemReducedMotion()` (media query only), `applyMotionAttribute(reduced: boolean)` (sets/removes the attribute and mirrors `localStorage['chatsundere.reduceMotion']` in try/catch), `applyStoredMotionAttribute()` for first paint.
- `main.tsx`: call `applyStoredMotionAttribute()` before the first render. App root (find the top-level component that already reads settings, e.g. `routes/root.tsx` or `App`): an effect applying `!settings.animationsEnabled`.
- Route the existing checks through it: screen-effects store, Lightbox, SplashOverlay, SpectrumAnalyser's media query, `BreathingOrb` and `NavTile` (via `useReducedMotion()` so a flip re-renders), `use-nav-zoom.ts`.
- Tests for the helper, the hook's live updates and the orb re-render.

**C-4. The switch.** `routes/app/settings/you.tsx` under Mindspace: "Reduce animations", helper and disabled note exactly as spec C1, visible text; disabled and pressed while `useSystemReducedMotion()`; otherwise pressed = `!animationsEnabled`, writes `animationsEnabled`. `routes/app/settings.tsx`: You tile meta "how the AI sees you · motion". `content/help/settings-you.md`: one paragraph on the switch. `components/voice/VoiceSection.tsx`: the one line under *Show screen effects* (spec C1); nothing else in that file. Component tests: system on ⇒ disabled + note; system off ⇒ toggles the field; live media change.

---

## Integration (me)

1. Merge the three worktree branches into `feat/050-time-export-motion`; resolve conflicts (expected only in `stream-manager.store.ts` imports, if any).
2. Gates: `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm lint`. Record counts.
3. Whole-branch review by a fresh reviewer subagent against the spec; fix wave.
4. Laura pre-squash pass on the diff; fix hard defects.
5. Merge `master` into the branch; the last commit must not carry `[skip ci]`; push; mark PR #57 ready; report to the coordinator.
6. Not mine: the imitation probe (A7) is Chris's, with his provider keys via `/curate`.
