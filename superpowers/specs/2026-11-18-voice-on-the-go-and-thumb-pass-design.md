# Voice on the go and the thumb pass — design

**Date:** 2026-11-18 · **Target:** 0.5.0 on `master` (branch `feat/050-voice-and-thumbs`) · **Size:** two small-to-medium units in `apps/user-client`, one spec

Two units from the 0.5.0 cut, both about using Chatsundere on a phone in a hand rather than on a desk:

- **Part A — Voice on the go.** The screen stays awake while the persona speaks or a live-voice conversation runs, and read-aloud can be paused, resumed and skipped from the lock screen and from a headset.
- **Part B — The thumb pass.** Every control is easy to hit with a thumb at 380 px, pinch-zoom works again, and the cockpit clears the iPhone home indicator.

Neither part touches the areas Eidolon rebuilds (Projects, memory, knowledge editing, the tool loop), and neither touches the Larissa paths (§9.1 of `CLAUDE.md`: auth-service, sync-service, proxy-service, `packages/crypto`). Not touched.

---

## Part A — Voice on the go

### Why

Neither `navigator.wakeLock` nor `navigator.mediaSession` is used anywhere in the client. Two consequences on a phone:

1. During live voice or a long read-aloud the phone dims and locks on its normal timeout (often 30 s). Live voice then stops listening mid-conversation, and read-aloud may stop when the page is hidden.
2. With the phone in a pocket and earbuds in, there is no way to pause or skip: no lock-screen controls, and the headset button does nothing.

### Goals

- **A1 Wake lock.** The screen stays on while voice is active: for the whole of live-voice mode, and while read-aloud (manual, auto-read, or inner monologue) is synthesising or speaking. Once voice ends, the screen sleeps again as normal.
- **A2 Media Session.** While read-aloud runs, the lock screen, the notification shade (Android), the desktop media controls and headset buttons offer **pause, resume, next segment, stop**. The persona's name and avatar are shown as metadata.
- **Fails silently.** A browser without either API, a refused wake lock, or an OS that ignores the session behaves exactly as today: no error, no toast, no console noise above `debug`.

### Non-goals

- No "previous paragraph". The voice machine has no backwards step (`voice-machine.ts` knows `SKIP`, not a previous). Adding one is a machine change for a later release; the lock screen does not show the button.
- No lock-screen controls for live voice (see Q4).
- No wake lock for dictation (single voice notes). Short, and the user is looking at the screen.
- No background playback guarantee. If a platform suspends audio while the screen is locked, we say so (below) rather than fight it.

### Anti-goals

- **Never leak conversation text onto the lock screen.** A lock screen is visible to whoever picks up the phone; Chatsundere is end-to-end encrypted and private by identity. Metadata carries the persona's name and avatar at most, never message text (see Q3 for adult personas).
- **Never keep the screen on after voice ends.** A forgotten wake lock drains the battery; release is tied to the same state that starts it, with unmount as a backstop.

### What browsers actually do (probed and known)

Probed on 2026-11-18 in the cloud session's Chromium 157 (headless, Linux) against the running client:

| Check | Result |
|---|---|
| `'wakeLock' in navigator` | true |
| `navigator.wakeLock.request('screen')` | **rejects** with `NotAllowedError` in headless (no visible screen). The code must catch this; it is the "fails silently" path. |
| `'mediaSession' in navigator`, `new MediaMetadata(…)` | true, metadata set and read back |
| `setActionHandler` for play, pause, stop, nexttrack, previoustrack, seekforward, seekbackward | all accepted |
| `navigator.audioSession` (WebKit's audio-session API) | absent in Chromium (WebKit-only) |
| Web Audio → `MediaStreamAudioDestinationNode` → hidden `<audio>` with `srcObject` | plays; `currentTime` advances (0.81 s after 0.8 s), `paused` false |

What a headless browser cannot show is whether an OS draws lock-screen controls. That depends on the platform, and the honest picture is:

- **The key fact:** our playback runs through an `AudioContext` (`audio-sink.ts`: decode, `AudioBufferSourceNode` → filter chain → `AnalyserNode` → `ctx.destination`). Platforms attach their media controls to **media elements** (`<audio>`/`<video>`), not to Web Audio output. Chrome on Android shows its media notification for media-element playback; Safari on iOS shows "Now Playing" for media-element playback. Web Audio alone is, as far as I know, not enough on either. So setting `navigator.mediaSession` alone would most likely do nothing on a phone. This is my understanding from the platforms' documented behaviour, not something this container can prove; it is the first thing the manual verification checks.
- **The plan therefore routes the sink's output through a media element** (the "bridge"): the analyser connects to a `MediaStreamAudioDestinationNode` instead of `ctx.destination`, and one hidden `<audio>` element per `AudioSink` plays that stream. The filter chain, the analyser (spectrum visualiser) and sample-accurate pause all stay as they are. If the bridge element refuses to play (autoplay policy, an old browser), the sink falls back to `ctx.destination` for its lifetime and Media Session is simply not offered: today's behaviour.

Expected support, to be confirmed on device (Manual verification, steps 1–9):

| Platform | Wake lock | Lock-screen / headset controls |
|---|---|---|
| **Android Chrome**, browser tab and installed PWA | Supported (Chrome 84+). Released automatically when the tab is hidden; we re-acquire on return. | Expected via the bridge: media notification and lock-screen controls with name and avatar; headset single press = play/pause, double press = next on most headsets. |
| **iOS Safari as an installed app** (home-screen PWA) | Supported in Safari since iOS 16.4; in home-screen apps it was broken until a WebKit fix in iOS 18.4 (as reported, to confirm on device). Older iOS: no wake lock, silent. | Media Session API since iOS 15. Now Playing with the bridge is **uncertain**: iOS may treat a `MediaStream`-fed `<audio>` like a call stream and not show it. If so, iOS keeps the in-app controls only, and the spec records it as a platform limit (see "If the bridge fails on iOS"). Also: iOS may suspend a page's audio when the phone is locked; the wake lock keeps it from locking on its own. |
| **Desktop** (Chrome, Edge, Firefox) | Chrome/Edge yes; Firefox 126+ yes. Rarely matters on a desk. | Chrome/Edge: the toolbar's media hub and the keyboard's media keys. Firefox: media keys and the OS media overlay. |

**If the bridge fails on iOS** (Now Playing never appears): the plan does not add a second hack (a looping silent `<audio>` file to claim the session). It is fragile, it fights iOS's own audio-session rules, and it would show a lock-screen entry whose controls do not match what is sounding. iOS then gets the wake lock only, and the release notes say so.

### Design

**A1 — `lib/voice/screen-wake-lock.ts`** (UI-free, unit-tested with a fake `navigator`):

- One module-level controller with **reasons**: `hold(reason)` / `let(reason)`, where a reason is one of `'live-voice' | 'read-aloud' | 'monologue'`. The screen is held while any reason is active. Reasons rather than a boolean, so live voice handing over to read-aloud (it does, on the persona's floor) never drops the lock in between.
- Acquires a `WakeLockSentinel` when the first reason arrives and the document is visible. On `visibilitychange` back to visible, re-acquires if a reason is still active (the platform releases the lock whenever the page is hidden). Releases when the last reason goes.
- Every call is wrapped: no API → no-op; a rejected request is logged at `debug` and otherwise ignored; a second request while one is pending is coalesced.
- `useScreenWakeLock(reason, active)` is the React face of it; on unmount it lets its reason go.

**Wiring in `routes/app/chat/chat-page.tsx`** (three lines, no logic of other features changed):

- `'live-voice'` while `isLiveVoice`, whatever the floor (listening, held, speaking: it is one conversation).
- `'read-aloud'` while `voice.transportState` is `'speaking'` or `'waiting'` (synthesising counts: the next words are coming).
- `'monologue'` while the monologue's `transportState` is `'speaking'` or `'waiting'`.
- Paused releases the lock (Q2).

**A2 — `lib/voice/media-session.ts` plus `use-read-aloud-media-session.ts`:**

- The hook takes the `VoicePlayback` controller, the persona (name, adult flag) and the avatar. While read-aloud is active (`transportState` is `speaking`, `waiting` or `paused`) and live voice is off, it:
  - sets `navigator.mediaSession.metadata`: `title` = the persona's name, `artist` = "Chatsundere", `artwork` = the persona's avatar (a 256 px square rendered once from the avatar blob, as a `blob:` URL revoked on teardown; the monogram tile when there is no avatar). No message text, ever.
  - registers `play` → `voice.resumeAudio()`, `pause` → `voice.pause()`, `nexttrack` → `voice.skip()`, `stop` → `voice.stop()`; sets `previoustrack`, `seekforward`, `seekbackward`, `seekto` to `null` so platforms hide them.
  - mirrors `playbackState`: `'playing'` for speaking/waiting, `'paused'` for paused.
- When read-aloud returns to idle (or the chat unmounts), it clears metadata, sets every handler to `null` and `playbackState` to `'none'`. A stale lock-screen entry pointing at a chat the user has left is the bug to avoid.
- "Next" follows the user's segmentation setting (`voiceMode`): next paragraph in paragraph mode, next sentence in sentence mode. It is the same Skip the in-app transport offers, so there is one meaning.
- Every `mediaSession` call is feature-detected and wrapped (`setActionHandler` throws on an unknown action in some browsers).
- The monologue (inner-thought read) gets the wake lock but not lock-screen controls: it is short, and has its own tap-to-stop pill.

**`AudioSink` bridge** (`lib/voice/audio-sink.ts`): the sink gains an opt-in output bridge (the constructor takes `{ mediaElementBridge: boolean }`; read-aloud passes `true`, the monologue sink `false`). `pause()` additionally pauses the bridge element and `resume()` plays it, so the OS sees the true state. `dispose()` stops and detaches the element. Existing behaviour is unchanged when the bridge is off.

### Questions for Chris (Part A)

- **Q2. Keep the screen awake while read-aloud is paused?** *Recommendation: no, release on pause and take it back on resume.* A pause often means "I'm done for now"; a lock held by a forgotten pause drains the battery, and the lock-screen controls still resume it.
- **Q3. What appears on the lock screen for an adult persona?** *Recommendation: for a persona with the adult flag on, show "Chatsundere" as the title and the app icon as artwork, not the persona's name and avatar.* Anyone near the phone sees the lock screen; an explicit avatar there is the kind of leak a privacy-first app must not have. Non-adult personas show name and avatar, as briefed.
- **Q4. Lock-screen controls during live voice?** *Recommendation: no.* Live voice is a conversation loop with its own floor logic (barge, hold); "pause" from a headset would have to mean "hold the mic", which is a new interaction to design. The wake lock covers the main live-voice problem (the screen locking mid-conversation).

---

## Part B — The thumb pass

### Why

The mobile UX analysis of 2026-11-18 (finding 6) measured many controls below a comfortable thumb target. Common guidance is 44 × 44 pt (Apple) or 48 × 48 dp (Material); WCAG 2.2 sets 24 × 24 as the AA floor (2.5.8) and 44 × 44 as AAA (2.5.5). We aim for **44 × 44** as the hit area. Finding 13 adds two platform faults: pinch-zoom is blocked, and the cockpit sits on the iPhone home indicator.

### Measured before (380 × 800, Chromium, 2026-11-18)

Measured with a Playwright sweep (onboarding a local account, a mocked OpenRouter key, one persona with a model) over 38 screens and sheets. Bounding boxes of every `button`, link, tab, switch and form control; listed when either side is below 44. The sweep script lands with the implementation as `apps/user-client/scripts/touch-targets.mjs` (a dev tool, not in CI) so the next pass can re-measure.

**The briefed controls:**

| Control | Where | Before (w × h) |
|---|---|---|
| Show-key eye | provider page | 10 × 24 |
| Close × | add-provider sheet | 18 × 32 |
| "Remove" under the avatar | persona hub/editor | 43 × 17 |
| "Open server linking →" | add-provider sheet, per blocked provider | 300 × 17 |
| "Select" | Treasury | 69 × 26 |
| Segmented tabs (`.cs-seg`) | History Chats/Bookmarks 144 × 30, Treasury All…Images 55 × 30, Roleplay First/Third person, Font Sans/Serif/Cursive | 30 high |
| "Test & Save" / "Test a model" | provider page | 110 × 32 / 120 × 34 |
| "+ Add provider" / "+ Add MCP server" | providers / integrations | 300 × 34 |
| ⋯ overflow (`.cs-overflow-trigger`) | Knowledge, My Circle | 32 × 32 |

**Found by the sweep, same fault:**

| Control | Where | Before |
|---|---|---|
| Brand logo (home link) / NSFW toggle / Connectivity pill | header on every page | 119 × 20 / 62 × 23 / 64 × 28 |
| Breadcrumbs (`.cs-pagebar-crumb`) | every sub-page | 29 high |
| Setup steps ("→ Connect a provider") | Entrance Hall | 29 high |
| Switches (`h-6 w-12` toggles, 12 copies in eight files) | previews, persona instructions/model/roleplay/memory, knowledge, templates | 48 × 24 |
| Small bordered buttons: "Change avatar", "Import a persona", Circle "New chat" | persona hub, Circle | 26 high |
| "Use default" | persona model behaviour | 79 × 17 |
| Mindspace swatches / texture pills / "Use user default" | persona mindspace | 28 × 28 / 26 high / 28 high |
| Range sliders | voice settings, persona model behaviour | 16 high |
| Voice-settings toggle rows, "Templates" row, image-model chips | settings, Treasury | 38 high |
| "Consolidate now" / "Save memory" | persona memory | 37 high |
| Filters button / Filter by persona | Treasury / History | 36 × 42 / 40 high |
| Other sheet close × (artefact picker, document picker, model picker, Treasury filter and tagging sheets, reader) | sheets | same pattern as the add-provider ×; measured during the build |
| Chat top bar: Quick menu (brand) / hamburger / avatar / context gauge | chat | 137 × 20 / 40 × 40 / 36 × 36 / 48 × 21 |
| Microphone / send (`.dual-action-btn`) | cockpit, end of row | 40 × 40 |
| Cockpit icon row (nine buttons) | cockpit | 25–35 × 34–38: **out of scope**, untouched |

Screens that need content the sweep could not create (a chat with replies, history rows, Treasury items, a knowledge library with documents, the lightbox) are swept in the plan's first task with seeded IndexedDB data; the rules below are class-level and reach them, but each one is measured, not assumed.

### Goals

- **B1.** Every control outside the cockpit icon row has a hit area of at least 44 × 44, or as close as its neighbours allow without overlapping (only the mindspace swatch row, below).
- **B2.** The visible design stays: glyphs, text, borders and fills look as they do now, except standalone action buttons that grow to the existing `cs-btn` height (Q1).
- **B3.** Pinch-zoom works on every screen; focusing a field still never zooms.
- **B4.** On an iPhone, the cockpit's send row clears the home indicator, with no gap doubled when the voice bar is also shown.

### Non-goals

- The cockpit's icon row (nine buttons) and the quick menu's position: design questions Chris wants to try on a device first. Not regrouped, removed, resized or moved.
- Text inputs at 41–42 px high. A field's target is its whole width, it sits within 7 % of the goal, and raising it changes every form's rhythm. Left as is.
- Inline links inside running prose (WCAG 2.5.8 exempts them).

### Design

**One primitive, two techniques, chosen by what the control paints:**

1. **Controls that paint no box** (glyphs, text buttons, links, the switch track's surroundings): an invisible hit area. A new utility class **`.cs-hit`** in `src/index.css`:
   - `position: relative` on the host; a `::before` (or `::after` where `::before` is already taken) with `content: ''`, `position: absolute`, centred, `width: max(100%, 44px)`, `height: max(100%, 44px)`. A pointer on the pseudo-element is a pointer on the host, so `onClick` and focus work unchanged. Nothing is painted, nothing in the layout moves.
   - Where a host already uses both pseudo-elements (e.g. `.brand-logo`'s sparkle), or sits in an `overflow: hidden` parent that would clip the pseudo-element (the breadcrumb row), the same effect comes from padding with an equal negative margin (`padding-block: X; margin-block: -X`): a bigger box, the same visible spot.
   - **Never overlap a neighbour.** Where controls sit closer than 44 apart, the hit area grows into the gap and stops at half of it. Only the mindspace swatch row is affected (28 px swatches at its current spacing); it gets 44 high and as wide as the gap allows, measured and stated in the report.
2. **Controls that paint a box** (border or fill): `min-height: 2.75rem` (44 px), text stays centred.
   - **Standalone action buttons** grow visibly to 44: "Test & Save", "Test a model", "+ Add provider", "+ Add MCP server", "Change avatar", "Import a persona", Circle "New chat", "Consolidate now", "Save memory", the voice-settings toggle rows, the Treasury "Templates" row. They then match `cs-btn` (43 today; `cs-btn` gets `min-height: 2.75rem` too, a 1 px change).
   - **Compact controls inside dense rows** keep their visible size and take `.cs-hit` instead: segmented tabs (`.cs-seg`), the image-model chips, the mindspace texture pills, Treasury "Select" and "Filters", the switches.

**Where the fix lives, so it covers many places at once:**

- `src/index.css`: `.cs-hit`; `cs-btn`, `cs-seg`, `cs-overflow-trigger` (grows to 44 itself: it paints a box only on hover, a round 44 px hover halo is within the language), `cs-pagebar-crumb`, `cs-setup-step`, the header chips (`brand-logo`, `adult-mode-toggle`, the connectivity pill), the sheet-close classes (`artefact-picker-close`, `document-picker-close`, `treasury-sheet-close`, `cs-reader-close`), range inputs (`input[type="range"]` gets `min-height: 44px` with a matching negative block margin, so the track is drawn where it is now).
- `components/ui/`: a small **`Switch`** primitive (`components/ui/Switch.tsx`) replacing the twelve copies of the `h-6 w-12` toggle markup, with the hit area built in. Twelve copies of the same markup is how the fault spread; one primitive is how it stays fixed. Behaviour, ARIA (`role="switch"`, `aria-checked`, `aria-labelledby`) and look are copied as they are.
- The remaining one-offs (show-key eye, the two Tailwind-styled close × buttons in `AddProviderPicker` and `ModelPickerModal`, "Remove", "Use default", "Open server linking →", Treasury "Select") get `.cs-hit` or the `min-height` class in place.
- **"Open server linking →"** sits directly under its provider row, so an invisible hit area would overlap the row's own button. It becomes a 44 px tall block with the text vertically centred: the sheet grows by about 27 px per blocked provider, the link looks the same.

**Chat top bar and the microphone.** The papercut session works on the chat top bar's content and logic. This pass changes only hit areas there (`.cs-hit` on the Quick-menu brand, the hamburger, the avatar and the context gauge; the mic/send button from 40 to a 44 hit area, invisibly). These are class additions; if the papercut session's diff touches the same elements, I merge `master` in and keep both.

**B3 — pinch-zoom.** `index.html` sets `maximum-scale=1`. The reason is documented in `src/index.css`: iOS Safari zooms in when a focused field's font is below 16 px, and the meta tag was added "as defence in depth" next to a rule that pins every `input`, `textarea` and `select` to 16 px below `lg`. The sweep confirms every field computes to 16 px at 380 px, so the rule does the job alone.

- Remove `maximum-scale=1` from the viewport meta (keep `width=device-width, initial-scale=1, viewport-fit=cover`).
- Add `touch-action: manipulation` on `html`: it keeps pinch-zoom and stops double-tap-to-zoom, so fast repeated taps (the composer, Skip) never zoom by accident.
- Nothing in the client handles pinch gestures itself (no `touch-action`, `gesturestart` or pinch code anywhere in `src/`), so no gesture conflicts. A side benefit: images in the lightbox can be pinched.
- Note: on iOS Safari in a browser tab, `maximum-scale` has been ignored for pinch since iOS 10, so the block mainly hit Android and possibly the installed iOS app. Step 13 checks both.

**B4 — the cockpit's safe area.** The chat's bottom stack is, in DOM and flex order: voice bar (`.voice-transport`, order 998) → affordance (999, reading mode only) → cockpit or its no-model stand-in (1000). Only the voice bar and the affordance add `env(safe-area-inset-bottom)`. With the cockpit open, the cockpit is the bottom edge, so its send row sits on the home indicator (measured with a 34 px inset emulated: the cockpit ends at the viewport's bottom with 8 px padding), and when the voice bar is also shown its inset lands mid-screen between the two bars.

- `.cockpit` and `.cockpit-unavailable`: bottom padding `calc(<current> + env(safe-area-inset-bottom, 0px))`.
- `.voice-transport:has(~ .cockpit, ~ .cockpit-unavailable)`: bottom padding back to `0.6rem`, so the inset is added once, at the real bottom edge. `:has()` is in Safari 15.4+ and Chrome 105+; where it is missing the inset is doubled (cosmetic, never covering).
- Live voice without the cockpit already ends with the live-voice bar; the build checks it carries the inset too.

### Question for Chris (Part B)

- **Q1. Boxed buttons: grow visibly to 44, or keep their look with an invisible hit area?** *Recommendation: the split above. Standalone action buttons grow to 44 so they match `cs-btn`, which already sits at 43; compact controls in dense rows (tabs, chips, switches, Select) keep their look and get an invisible hit area.* The mismatch between 32 px "Test & Save" and a 43 px "Check server" is an inconsistency of its own, and dense rows would look bloated at 44.

---

## Audit gates

- **Laura**, spec-pass now; pre-squash pass on the built diff. Her spec-pass findings are worked in below.
- **Larissa**: not required (no §9.1 paths). The one privacy-shaped decision, what the lock screen shows, is Q3 and the anti-goal above.

## Laura's spec-pass

*(Filled in after her pass.)*

## Left to the builder

- The exact artwork pipeline (canvas render of the avatar crop to 256 px, or the stored thumbnail if one exists).
- Which pseudo-element each host can spare, decided by reading each class.
- Unit tests: the wake-lock controller (reasons, visibility re-acquire, rejection swallowed, no API), the media-session hook (handlers set and cleared, playbackState mirrored, adult-persona metadata), the `Switch` primitive (ARIA, toggling). The bridge and the OS surfaces are covered by manual verification; jsdom has no audio.
- Re-run the sweep after the change and put before/after numbers in the report.

## Manual verification (Chris, on device)

Devices: **A** = a real Android phone with Chrome (browser tab and installed PWA), **I** = a real iPhone with the app installed to the home screen, **D** = desktop Chrome. Set the phone's screen timeout to 30 s before steps 1–4.

**Part A — voice**

1. **(A, I)** Open a chat with a voice-enabled persona, start a long read-aloud, put the phone down. *Pass:* the screen does not dim or lock while she speaks. After she finishes, the screen dims on the normal timeout.
2. **(A, I)** Start read-aloud, pause it, wait 40 s. *Pass (with Q2 as recommended):* the screen dims and locks on the normal timeout. Resume from the lock screen (step 5) or in the app; the screen stays awake again.
3. **(A, I)** Enter live voice, talk a few turns, then sit silently for a minute while it listens. *Pass:* the screen never locks during live voice; after leaving live voice it locks on the normal timeout.
4. **(A)** During a read-aloud, switch to another app for 10 s and come back. *Pass:* the screen again stays awake (the lock was re-acquired).
5. **(A)** During read-aloud, lock the phone with the power button. *Pass:* the lock screen shows a media entry with the persona's name and avatar; pause, play and next work and match what you hear; no previous/seek buttons; no message text anywhere.
6. **(A)** Pull down the notification shade during read-aloud. *Pass:* the same entry and controls; it disappears within a few seconds of read-aloud ending or of leaving the chat.
7. **(A, I)** With wired or Bluetooth earbuds: single press pauses and resumes; double press skips to the next paragraph (in paragraph mode). *Pass:* as described, where the headset supports it.
8. **(I)** Lock the iPhone during read-aloud. *Record what happens:* Now Playing with name and avatar and working controls is a pass. If no Now Playing entry appears, note it; that is the known iOS limit and the release notes will say so. Either way, nothing errors and in-app controls keep working when you unlock.
9. **(D)** During read-aloud, use the keyboard's play/pause and next-track keys, and Chrome's media hub in the toolbar. *Pass:* they pause, resume and skip.
10. **(A or I)** Read aloud with an adult persona and lock the phone. *Pass (with Q3 as recommended):* the lock screen shows "Chatsundere" and the app icon, not the persona's name or avatar.
11. **(any)** On a browser without the APIs, or with wake lock refused (e.g. battery saver on Android): *Pass:* voice works as before, no error shown, no console error.

**Part B — thumbs**

12. **(A or I)** With one thumb, tap each control from the "Measured before" tables: the show-key eye, every sheet's ×, "Remove", "Open server linking →", "Select", the tabs in History and Treasury, "Test & Save", "Test a model", "+ Add provider", "+ Add MCP server", the ⋯ on Knowledge and My Circle, the switches, the breadcrumbs, the header chips. *Pass:* each hits on the first try, including taps slightly off the visible glyph, and never triggers the neighbouring control.
13. **(A, I)** Pinch to zoom on the Entrance Hall, in a chat, and on an image in the lightbox. *Pass:* the page zooms and zooms back. Then tap into the composer and a Settings field. *Pass:* no automatic zoom on focus. Tap Skip several times fast. *Pass:* no double-tap zoom.
14. **(I)** Open a chat with the cockpit open. *Pass:* the send row sits clearly above the home indicator. Start read-aloud so the voice bar shows above the cockpit. *Pass:* no extra gap between the voice bar and the cockpit, and the cockpit still clears the indicator.
15. **(A, I)** Look at the screens touched (provider page, sheets, persona hub, Treasury, History, Settings, persona sub-pages). *Pass:* everything looks as before, except the standalone action buttons, now as tall as the other big buttons (per Q1).
