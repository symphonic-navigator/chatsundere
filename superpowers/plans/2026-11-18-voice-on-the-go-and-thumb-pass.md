# Voice on the go and the thumb pass — implementation plan

**Spec:** [`superpowers/specs/2026-11-18-voice-on-the-go-and-thumb-pass-design.md`](../specs/2026-11-18-voice-on-the-go-and-thumb-pass-design.md) (approved by Chris 2026-11-18, Q1–Q5 as recommended)
**Branch:** `feat/050-voice-and-thumbs` (cut from `master`). All work in `apps/user-client`. No Larissa paths.
**Execution:** subagent-driven, one task at a time on the same working tree, in this order. Each task ends with its own commit (imperative subject, British English, co-author lines as in `CLAUDE.md` §8). Subagents never push, merge, rebase or switch branches.

**Gates for every task:** `pnpm --filter @chatsundere/user-client test`, `pnpm --filter @chatsundere/user-client typecheck`, `pnpm exec biome check apps/user-client`. The full `pnpm test`, `pnpm typecheck` and `pnpm run build` run at the end (Task 9).

**Order matters:** Tasks 1–6 (wake lock and Part B) must not depend on anything in Tasks 7–8 (the bridge and Media Session). Tasks 7 and 8 are their own commits, so they can be reverted or switched off (`READ_ALOUD_MEDIA_BRIDGE`) without touching the rest.

**Shared file:** `src/index.css` is edited by three other parallel sessions. Keep edits there grouped: new rules go into one block headed `/* ── Thumb pass (0.5.0) ── */` near the end of the file; existing rules are changed in place only where that is the smaller diff (`.cockpit`, `.cockpit-unavailable`, `.cs-btn`, `.cs-seg`, `.cs-overflow-trigger`, `.cs-pagebar-crumb`).

---

## Task 1 — Measuring tool with overlap check

Create `apps/user-client/scripts/touch-targets.mjs` (dev tool, not in CI; AGPL header; documented in a header comment and in `apps/user-client/README.md` if a scripts section exists). Starting point: `/tmp/claude-0/-home-user-chatsundere/9af48d0f-6c58-5f6c-83a2-1406f492614e/scratchpad/m/lib.js` and `full.js` (read them; they work against `vite` on port 5173).

- Runs against a running dev server (`--url`, default `http://localhost:5173`), 380 × 800, `hasTouch`, `isMobile`, safe-area inset emulated (`Emulation.setSafeAreaInsetsOverride {bottom: 34, top: 47}`).
- Setup as in `full.js`: onboard "Just this device", mock `https://openrouter.ai/**`, save a key, create persona "Aiko" with "ChatGPT 4o" via OpenRouter. **Extend** it so content screens are reachable: mock the OpenRouter chat-completions endpoint with an OpenAI-style SSE stream so a chat gets two real replies (then: message actions, History rows, Bookmarks); create a knowledge library with one document; an adult persona (adult flag on) for Task 8's checks is not needed here.
- Navigation is client-side only (`history.pushState` + `popstate`): a reload loses the session's master key.
- Output: JSON and a text table per screen: every `button`, link, `[role=button|tab|switch|menuitem|radio|checkbox]`, form control and `summary` with either side below 44, with **hit area** = the element's box united with its `::before`/`::after` box when those are `position: absolute`.
- **Overlap check:** for every interactive element, sample a 4 px grid over its hit area with `document.elementFromPoint`; report any point that resolves to (or inside) a *different* interactive element. Exit code 1 when overlaps exist (`--allow-overlap` to override).
- Run it once now on the unchanged code and save the output to the scratchpad as `before.json`/`before.txt` (the content-screen numbers complete the spec's "before" table). Commit only the script.

## Task 2 — Screen wake lock (A1) with the Q5 ceiling

- `src/lib/voice/screen-wake-lock.ts`: module-level controller with reasons `'live-voice' | 'read-aloud' | 'monologue'`; `holdScreen(reason)`, `letScreen(reason)`; acquire when the first reason arrives and `document.visibilityState === 'visible'`; re-acquire on `visibilitychange` → visible while a reason is held; release when the last reason goes; coalesce concurrent requests; every API call feature-detected and wrapped (rejection → `console.debug`). Export a test-only reset.
- `src/lib/voice/use-screen-wake-lock.ts`: `useScreenWakeLock(reason, active)`; lets its reason go on unmount.
- Wiring in `routes/app/chat/chat-page.tsx` (only these lines):
  - `'read-aloud'`: `voice.transportState === 'speaking' || === 'waiting'` (paused releases, Q2).
  - `'monologue'`: the monologue's `transportState` speaking/waiting.
  - `'live-voice'`: `isLiveVoice && !liveVoiceIdle`, where `liveVoiceIdle` becomes true after the floor has stayed `'listening'` for 5 minutes continuously (Q5) and resets as soon as the floor changes. Put the timer in a tiny hook `src/lib/voice/live/use-live-voice-idle.ts` (`useLiveVoiceIdle(floor, isLiveVoice, ms = 300_000)`), with fake-timer tests.
- Tests (Vitest, jsdom, fake `navigator.wakeLock`): no API → no throw; reasons overlap without a release in between; release on last reason; re-acquire on visibility; rejected request swallowed; unmount lets go; idle hook fires after 5 min of `'listening'` and resets on another floor.
- Commit: "Keep the screen awake during live voice and read-aloud".

## Task 3 — Thumb pass: shared CSS primitives

In `src/index.css`:

- `.cs-hit`: `position: relative` (unless the host is already positioned); `::before` absolutely centred, `width: max(100%, 44px)`, `height: max(100%, 44px)`, `content: ''`. Plus `.cs-hit-after` (same on `::after`) and `.cs-hit-pad` (padding + equal negative margin, for hosts whose pseudo-elements are taken or whose parent clips). Read each host's existing pseudo-elements before choosing.
- `.cs-btn`: `min-height: 2.75rem`.
- `.cs-seg`: invisible hit area to 44 high (it sits in `.cs-segmented`; check the spill against the rows above/below with the Task 1 overlap check, and cap with the half-gap rule if needed).
- `.cs-overflow-trigger`: 44 × 44 (its hover halo grows with it).
- `.cs-pagebar-crumb`: `.cs-hit-pad` technique (the row is `overflow: hidden`), 44 high and at least 44 wide.
- `.cs-setup-step`, the header chips (`.brand-logo` home link, `.adult-mode-toggle`, the connectivity pill — find its class), the sheet closes (`.artefact-picker-close`, `.document-picker-close`, `.treasury-sheet-close`, `.cs-reader-close`, `.lightbox-x`): invisible hit area.
- `input[type="range"]`: `min-height: 44px` with matching negative `margin-block`, so the track stays where it is.
- `html { touch-action: manipulation; }`.
- In `index.html` remove `maximum-scale=1` from the viewport meta (keep `width=device-width, initial-scale=1, viewport-fit=cover`). Update the comment above the 16 px input rule in `index.css`: it no longer "pairs with maximum-scale=1"; it is now the sole guard.
- Commit: "Enlarge shared touch targets and allow pinch-zoom".

## Task 4 — `Switch` primitive

- `src/components/ui/Switch.tsx` (export from `components/ui/index.ts`), JSDoc'd: props `checked`, `onChange(next)`, `disabled`, `labelledBy` *or* `label` (renders a visually present `<label>` that also toggles, per Laura's finding), `title`, `className`. Look and markup copied from the existing `h-6 w-12` toggles (track `h-6 w-12 rounded-full border`, knob `h-5 w-5 translate-x-6`), plus `.cs-hit`. `role="switch"`, `aria-checked`.
- Replace all 12 copies: `routes/app/settings/previews.tsx` (1), `persona/roleplay.tsx` (3), `persona/model-behaviour.tsx` (1), `persona/instructions.tsx` (2), `persona-memory.tsx` (1), `knowledge/library.tsx` (1), `knowledge/document.tsx` (1), `treasury/template.tsx` (2). Keep each call site's exact behaviour, `disabled` and `title` logic and its tests green; where a row label exists, make it toggle the switch.
- Tests: renders `role="switch"` with `aria-checked`, toggles on click and on label click, does nothing when disabled.
- Commit: "Add a Switch primitive with a thumb-sized hit area".

## Task 5 — Thumb pass: the one-offs

Per spec Q1: **standalone action buttons grow visibly** to `min-height: 2.75rem` (add a small shared class, e.g. `.cs-tap-44` = `min-height: 2.75rem` + flex centring, rather than repeating Tailwind values); **compact controls** get `.cs-hit`.

- Visible to 44: provider page "Test & Save" and "Test a model" (`routes/app/settings/provider.tsx`); "+ Add provider" (providers page); "+ Add MCP server" (integrations); "Change avatar", "Import a persona", "Import chats from ChatGPT or Grok…" (persona hub / `AvatarField.tsx` and the import section); Circle "New chat"; "Consolidate now", "Save memory" (persona memory); the voice-settings toggle rows (`settings/voice.tsx`, 38 → 44); Treasury "Templates" row; History "Filter by persona" (40 → 44).
- Invisible hit area: show-key eye (`provider.tsx`), the close × in `AddProviderPicker.tsx` and `ModelPickerModal.tsx`, "Remove" under the avatar, "Use default" (model behaviour), Treasury "Select" and "Filters", the image-model chips (`settings/images.tsx`), the mindspace swatches, texture pills and "Use user default" (persona mindspace; swatches capped by the half-gap rule), the chat top bar's Quick-menu brand, hamburger, avatar and context gauge, and the mic/send `.dual-action-btn` (deliberate exception: stays 40 visible).
- "Open server linking →" in `AddProviderPicker.tsx`: a 44 px tall block (`min-height: 2.75rem`, flex, items centred), same text styling.
- Then everything else the Task 1 sweep reports on the content screens (message actions, History rows, Bookmarks, Treasury items, knowledge documents, lightbox), fixed by the same two rules. **Do not touch** `.cockpit-icon-btn` or the cockpit row's layout, nor the quick menu's position.
- Commit: "Enlarge the remaining touch targets".

## Task 6 — Safe area at the bottom

- `.cockpit`: `padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom, 0px))`; `.cockpit-unavailable` likewise from its `0.75rem`.
- `.voice-transport:has(~ .cockpit, ~ .cockpit-unavailable) { padding-bottom: 0.6rem; }` (DOM order is voice bar, then cockpit; the live-voice bar shares `.voice-transport`). Verify in the chat DOM that the voice bar really precedes the cockpit as a sibling; adjust the selector if they live in different parents.
- Keyboard guard: `src/lib/use-keyboard-open.ts`, a `visualViewport` listener that sets `data-keyboard-open` on `document.documentElement` when `visualViewport.height < window.innerHeight - 120`; mounted once in the chat page. CSS: under `[data-keyboard-open]` the cockpit's and voice bar's bottom inset is dropped. Fails silently without `visualViewport`. Test the hook with a fake `visualViewport`.
- Commit: "Clear the home indicator below the cockpit".

## Task 6b — Measure after

Run the Task 1 tool again (save `after.json`/`after.txt` in the scratchpad), fix every remaining undersized control that is not a stated exception (text inputs 41–42 high, inline prose links, `.cockpit-icon-btn`) and **every overlap**. Iterate until the overlap check is clean. Commit fixes (if any) as "Fix touch-target overlaps found by the sweep".

## Task 7 — The read-aloud bridge (own commit)

In `src/lib/voice/audio-sink.ts`:

- `export const READ_ALOUD_MEDIA_BRIDGE = true;` plus a test-only override read once per sink: `localStorage['cs.readAloudBridge']` = `'on' | 'off'` (wrapped in `try`/`catch`).
- `new AudioSink({ mediaElementBridge })`: read-aloud passes `READ_ALOUD_MEDIA_BRIDGE` (after the override), the monologue sink `false`.
- `setRoute('bridge' | 'direct')`: `bridge` connects the analyser to a `MediaStreamAudioDestinationNode` played by one hidden `HTMLAudioElement` (created lazily, never attached to the DOM unless a platform needs it — check); `direct` connects it to `ctx.destination`. Switching route reconnects only the analyser's output.
- Element state follows read-aloud, not the sink: a method `setElementActive(active: boolean)` plays or pauses the element; `pause()`/`resume()` pause/play it as well; `dispose()` pauses it, clears `srcObject`.
- The element's own `pause`/`play` events are reported through an `onElementPause`/`onElementPlay` callback, so `use-voice-playback.ts` maps them to `PAUSE`/`RESUME` when they did not come from us (guard against echo with a flag).
- `primeBridge()`: a muted `play()` on the element, called on the first user gesture in the chat (send, mic, a Read button; wire from `chat-page.tsx` via the `VoicePlayback` controller, e.g. `voice.primeOutput()`). If a bridged `play()` is refused, that read uses `direct`; the next read tries the bridge again.
- In `use-voice-playback.ts`: route = `direct` while `forceStreamingRead` (live voice) else `bridge` (when enabled); element active while `transportState` is speaking/waiting, inactive otherwise.
- Tests: the route/element logic with a fake `AudioContext` and fake `HTMLAudioElement` (play rejection → direct for that read, retry next read; live voice → direct; idle → element paused; external pause → `PAUSE` sent once).
- Commit: "Route read-aloud through a media element for platform controls".

## Task 8 — Media Session for read-aloud (own commit)

- `src/lib/voice/media-session.ts` (UI-free helpers, all feature-detected and wrapped) and `src/lib/voice/use-read-aloud-media-session.ts`.
- Active only when `READ_ALOUD_MEDIA_BRIDGE` (after override) is on, live voice is off, and read-aloud is speaking/waiting/paused.
- Metadata: non-adult persona → `title` = persona name, `artist` = "Chatsundere", `artwork` = 256 px square PNG rendered from the avatar (`usePersonaAvatar`, apply its stored crop; `blob:` URL revoked on teardown), or `/icons/icon-512.png` without an avatar. Adult persona (`adultPersona` flag) → `title` "Chatsundere", artwork `/icons/icon-512.png`, no artist. Never message text.
- Handlers: `play` → `voice.resumeAudio()`, `pause` → `voice.pause()`, `nexttrack` → `voice.skip()`, `stop` → `voice.stop()`; `previoustrack`, `seekforward`, `seekbackward`, `seekto` → `null`. `playbackState` mirrored.
- Teardown on idle and unmount: metadata `null`, all handlers `null`, `playbackState = 'none'`.
- Wired in `chat-page.tsx` next to the voice hooks.
- Tests with a fake `navigator.mediaSession`: handlers set/cleared, state mirrored, adult metadata, nothing registered in live voice or with the bridge off, a throwing `setActionHandler` swallowed.
- Commit: "Offer lock-screen and headset controls for read-aloud".

## Task 9 — Finish

1. Full gates from the repo root: `pnpm test`, `pnpm typecheck`, `pnpm run build`, `pnpm exec biome check .`. Record the numbers.
2. Before/after table for the report from the Task 1 runs.
3. Laura pre-squash pass on the branch diff; fix hard findings, record soft ones.
4. `git fetch origin master && git merge --no-edit origin/master`; resolve `index.css` conflicts keeping both sides; re-run the gates.
5. Make sure the branch's last commit is not `[skip ci]`; push; mark PR #59 ready; report to the coordinator (built items, gates, measurements, Laura, deferrals, manual steps per device, proposed STATUS and ledger changes).
