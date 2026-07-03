# UX deferrals — Laura audit findings

This file logs UX findings from Laura (Opus audit subagent) that I (Liz)
consciously deferred rather than fixing before squash. The UX mirror of
[`security-deferrals.md`](security-deferrals.md). Chris reviews this file at every
release cut.

Only **hard defects** (objective usability failures — excessive click-depth,
buried functions, invisible affordances, unreachable functions, dead-ends,
misdirection) get logged here. Soft findings are advice, not debt, and are not
recorded.

## Entry format

```markdown
## YYYY-MM-DD — Short title

- **Affected flow / surface:** Where in the user-client.
- **Finding (Laura's summary):** Short, faithful paraphrase.
- **Mode:** spec-pass / pre-squash / holistic sweep.
- **Criterion:** which principle, tenet, or checklist item.
- **Rationale for deferral:** Why this is acceptable to ship now.
- **Follow-up commitment:** What I will do, by when (release / milestone).
- **Chris sign-off:** Required for a genuinely blocking hard defect.
```

## Ground rules

- A genuinely blocking hard defect is not deferrable without explicit Chris
  sign-off in this file.
- Every deferral has a follow-up. "We will think about it" is not a follow-up.
- If a deferral has not been resolved by its committed milestone, it bubbles up to
  the next release cut for re-evaluation.

---

## 2026-06-12 — Dictation mic invisible while the draft has text

- **Affected flow / surface:** Chat cockpit, DualActionBtn (dictation entry
  point, Spec 2 — dictation/STT).
- **Finding (Laura's summary):** The button shows the mic only when the draft
  is empty; with any text present the dictation capability is wholly absent
  from view rather than greyed-out-with-reason — an invisible affordance under
  the disable-over-hiding rule. (Distinct from the arbitrated no-mixed-mode /
  no-restart-with-text decisions D1/D3, which stand; the finding concerns the
  missing *visible, reasoned* signal for them.)
- **Mode:** spec-pass.
- **Criterion:** Invisible affordance / "everything at their fingertips";
  CLAUDE.md §11 "disabled over hidden".
- **Rationale for deferral:** The one-button morph is the WhatsApp pattern,
  learned by millions — the mic is self-discoverable in every fresh chat
  (every draft starts empty). A permanently visible disabled mic would cost
  cockpit space at 380 px in the most common state (typing) to advertise a
  capability the user has already seen. Omakase: the pure single-button model
  wins.
- **Follow-up commitment:** Re-evaluate at the Spec 3 (live voice) design,
  which adds a permanent voice surface to the cockpit anyway — if a natural
  always-visible home for the mic emerges there, the deferral resolves for
  free. Bubble up at the v0.1.0 release cut otherwise.
- **Chris sign-off:** ✅ Chris, 2026-06-12 ("steht da schon was im Input-Feld,
  dann ist der Button fürs Absenden zuständig" — deliberate single-button
  purity).

## 2026-06-12 — Dictation is pointer-only (no keyboard path to the mic)

- **Affected flow / surface:** Chat cockpit, DualActionBtn mic state (Spec 2 — dictation/STT).
- **Finding (quality-review summary):** The mic button is wired via pointer events only (`pointerdown`/`pointerup`/`pointerleave`). A keyboard user can Tab to it, but Space/Enter fire `click`, which the mic state does not handle — dictation is unreachable without a pointing device.
- **Mode:** pre-squash (code-quality review finding, logged Laura-style).
- **Criterion:** Unreachable function (for keyboard-only users); accessibility.
- **Rationale for deferral:** Chatsundere is mobile-first (380 px, touch); push-to-talk is inherently a pointer gesture, and a keyboard-only user has the textarea — the input the transcript would land in — directly focused beside the button. The spec deliberately scoped no keyboard gesture design.
- **Follow-up commitment:** Design a keyboard affordance (e.g. Space toggles a VAD session while the mic is focused) at the Spec 3 (live voice) design session, where the voice surface is rethought anyway. Bubble up at the v0.1.0 release cut otherwise.
- **Chris sign-off:** Not yet sought (not judged blocking: the affected modality has an equivalent typed path in the same control cluster). Listed for his release-cut review.

## 2026-06-12 — Read-aloud can start over a listening VAD session

- **Affected flow / surface:** Chat — voice playback (Read control) started while a dictation VAD session listens (Spec 2 — dictation/STT).
- **Finding (Laura's summary):** The dictation→playback direction is wired (starting capture stops read-aloud, spec D13), but the reverse is deliberately uncoupled: a user can start a read-aloud while the mic is hot; the speaker output may then be transcribed into the draft (echoCancellation on the capture stream mitigates in most browsers).
- **Mode:** pre-squash.
- **Criterion:** Least astonishment.
- **Rationale for deferral:** Spec-sanctioned (§3.5/§4.3/D11): the two voice machines do not communicate in Spec 2 beyond the one stop call — Spec 3 (live voice) owns the full orchestration. Laura ruled acceptable-with-log.
- **Follow-up commitment:** Spec 3's orchestration design must define the reverse seam explicitly (likely: starting a read stops or pauses listening). Inherited by the Spec 3 brainstorm.
- **Chris sign-off:** Not required (soft finding, spec-sanctioned).

## 2026-06-12 — Unconfigured voice slot entries are invisible to keyboard/SR traversal

- **Affected flow / surface:** My Settings → Voice, the Read-aloud-voice and
  Speech-to-text slot pickers (`apps/user-client/src/components/voice/OfferingSlotPicker.tsx`,
  the unconfigured-entry branch) — xAI voice onboarding unit.
- **Finding (Laura's summary):** Disabled (unconfigured) entries render as
  non-focusable `aria-disabled` divs; keyboard and screen-reader users cannot
  reach the row or hear its actionable hint, partially defeating
  disabled-over-hidden for that audience. The configured entries, the
  Automatic row and the trigger are all proper focusable buttons.
- **Mode:** pre-squash.
- **Criterion:** CLAUDE.md §11 "disabled over hidden" (perceivability for all
  audiences); ND-friendly tenet.
- **Rationale for deferral:** Not a dead-end or buried function — the remedy
  (configure the provider in My Settings) is reachable through fully
  keyboardable surfaces, and the visual audience gets the full reasoned
  signal. Laura ruled deferral-candidate, not blocking. Same bucket as the two
  existing keyboard deferrals from the dictation unit.
- **Follow-up commitment:** Render disabled entries as `<button disabled>` (or
  `tabindex=0` + `aria-describedby` hint) in the Spec 3 voice-surface
  accessibility pass, alongside the two existing keyboard deferrals. Bubble up
  at the v0.1.0 release cut otherwise.
- **Chris sign-off:** Not yet sought (soft-tier per Laura). Listed for his
  release-cut review.

## 2026-06-13 — Auto-read-aloud: two soft notes (Laura pre-squash)

Both raised at Laura's pre-squash pass of the auto-read-aloud unit (squash
`e39c70b`). Advisory, not blocking; the pass itself was PASS (no hard defects).

1. **Manual read button discloses the reason but offers no route-to-Settings.**
   - Surface: `apps/user-client/src/components/chat/MessageControls.tsx` (the
     `ctrl-note` disabled-reason output).
   - Finding: the cockpit voice-mode toggle taps through to Settings → Voice;
     the per-message read button only states the reason. Same underlying fix,
     asymmetric affordance. Spec-conformant (the route was deliberately scoped to
     the cockpit toggle in §8), so this is a conscious-asymmetry decision, not a
     defect.
   - Criterion: constructive error handling / "next step at the fingertips".
   - Rationale for deferral: spec scoped it; the cockpit is the "home" of voice
     mode. Reachable fix either way.
   - Follow-up: Chris arbitrates — either add the same Settings link to the
     read button's note, or consciously accept the asymmetry. Revisit at the
     styling pass.

2. **"reading…" carries the whole "still going" reassurance through static copy.**
   - Surface: `apps/user-client/src/components/chat/VoiceTransport.tsx` (the
     `waiting`-state note).
   - Finding: during a long silent `waiting` gap the only signal is a static
     lowercase "reading…". A subtle breathing/pulse cue (the project's
     breathing-orb idiom for moments of presence) would carry the "silence =
     still alive" load better for the ND audience.
   - Criterion: ND-friendly / least astonishment.
   - Rationale for deferral: explicitly a styling-pass concern (spec §10 routes
     calm/typography there); mechanics are sound.
   - Follow-up: address in the auto-read-aloud / voice styling pass.
   - Chris sign-off: not sought (soft-tier). Listed for the styling pass.

## 2026-06-14 — Spectrum analyser: off-state sub-controls collapse (conscious "disabled over hidden" exception)

Raised at Laura's pre-squash pass of the spectrum-analyser unit (squash
`3279cba`). Soft-tier — Laura explicitly ruled it **not** a hard defect; logged
here as a conscious, Chris-signed-off exception to the §11 "disabled over hidden"
house rule, for the release-cut trail.

- **Affected flow / surface:** Settings → Voice → Spectrum analyser
  (`apps/user-client/src/components/voice/VoiceSection.tsx`).
- **Finding (Laura's summary):** When the analyser is toggled off, the
  style / opacity / bar-count sub-controls are not rendered (collapse) rather than
  shown greyed-disabled with a reason — a literal divergence from "disabled over
  hidden".
- **Mode:** pre-squash.
- **Criterion:** §11 "Disabled over hidden".
- **Rationale for deferral:** Not a hard defect — the master enable toggle that
  gates them stays visible directly above, no capability is lost or hidden, and
  there is no astonishment about why they vanished (the user just toggled the
  thing they belong to). Collapsing reads calmer for the ND audience than three
  dead grey rows; distinct from hiding a standalone capability.
- **Follow-up commitment:** Revisit at the design-language pass — keep the
  collapse unless the greyed-disabled treatment reads better in context then.
- **Chris sign-off:** Given 2026-06-14 — keep the collapse, log as a conscious
  exception (his explicit call when I surfaced Laura's SOFT-1).

## 2026-06-14 — Audio toolbar: empty note line collapses (reduced-motion legibility narrowed)

Raised at Laura's final pre-squash sweep of the audio toolbar (squashed into the
toolbar feature commit). Soft-tier — Laura ruled it **not** a hard defect; logged
as a conscious narrowing of a spec promise, for the release-cut trail.

- **Affected flow / surface:** the audio toolbar
  (`apps/user-client/src/components/chat/VoiceTransport.tsx`).
- **Finding (Laura's summary):** Spec §4.1 argued that under
  `prefers-reduced-motion` the toolbar loses its only motion cue, so the note
  line "must be populated immediately" to make the newly reserved space legible.
  The note line now collapses when empty (Chris's call, to keep the toolbar
  compact in the common states), so the armed / plain-speaking states appear
  under reduced-motion as a silent instant block of chrome with no caption.
- **Mode:** pre-squash (final sweep).
- **Criterion:** Principle of least astonishment / ND-friendly (spec §4.1).
- **Rationale for deferral:** Not a hard defect — the space-reservation jump is
  itself a cue, and every button now carries an in-button caption ("Pause",
  "Skip", "Exit"), so the surface is labelled even without a note. The dropped
  text was the auto-read explainer, judged redundant (the open toolbar plus the
  "● ready" indicator is signal enough, and is the more *dere* choice).
- **Follow-up commitment:** Revisit at the design-language pass if the
  reduced-motion path reads as abrupt on device; the in-button captions are
  judged sufficient legibility for now.
- **Chris sign-off:** Given 2026-06-14 — drop the armed text and collapse the
  empty note line (his explicit call after device-testing on multiple sizes).

## 2026-06-17 — Live voice: Skip is disabled while Held-from-persona-speaking (§4 "per prior phase" divergence)

Raised at Laura's pre-squash pass on the live-voice surface (squashed into the
live-voice feature commit `7faf336`). Soft-tier — Laura ruled **no hard defects**;
logged here as a conscious, Chris-signed-off divergence from the §4 table, for the
release-cut trail.

- **Affected flow / surface:** live-voice toolbar
  (`apps/user-client/src/components/chat/LiveVoiceBar.tsx`, `canSkip = floor === 'personaSpeaking'`).
- **Finding (Laura's summary):** The §4 floor table gives the Held row's Skip
  column as "per prior phase" — if you held *while the persona spoke*, Skip should
  stay available so you can skip directly from Held. The build disables Skip
  unconditionally while Held, so you must Resume (→ `personaSpeaking`, where Skip
  re-enables) and then Skip.
- **Mode:** pre-squash.
- **Criterion:** Principle of least astonishment; spec §4 Held row.
- **Rationale for deferral:** No function is unreachable — Resume-then-Skip works,
  so it is a one-extra-tap divergence, not a dead-end. Honouring the table is not a
  pure flag flip: it needs `heldFromPersona` threaded to the bar **and** a device
  check of what `skip()` does while the playback gate is frozen (skip-while-paused
  is an untested path). It also slightly breaks the "Held = everything frozen"
  purity. Passes Chris's deferral filter on all three gates — not needed, costs
  usability ("eng"), no gamechanger.
- **Follow-up commitment:** Re-evaluate at the big UI/UX round; otherwise deferred
  indefinitely unless the alpha surfaces a user need for it (user-driven, classic
  agile — see [[../decisions/0031-eight-block-roadmap-to-beta]] and the
  feature-inclusion filter recorded in memory `feedback_feature_inclusion_filter`).
- **Chris sign-off:** ✅ Chris, 2026-06-17 ("ja, deferral") — explicitly invoking
  the mobile-usability-over-goldplating filter; this is precisely the class of
  "functionally easy but UX-tight" feature deferred until requested.

## 2026-06-21 — Compact-and-continue: two soft notes (Laura pre-squash)

Both raised at Laura's pre-squash pass of the compact-and-continue unit (squashed
to master `5b49125`). Soft-tier — the pass found one HARD defect (the block-compact
"Compacting…" overlay was unbuilt), which was **fixed before squash**, not deferred;
these two are the remaining advisory notes.

1. **Block-and-compact failure offers "Retry" but not "Send anyway".**
   - Surface: the Layer-3 synchronous failsafe failure toast
     (`apps/user-client/src/state/stream-manager.store.ts`, the block-compact catch).
   - Finding: spec §3 Layer 3 promised BOTH *Retry* and *Send anyway* (the latter
     falling back to the silent-truncation maths once, with a note). The build ships
     only Retry. The user's typed message is always preserved, so it is not a hard
     dead-end, but on a *persistent* summariser failure (bad key, provider down) the
     always-works escape (send-anyway via `truncateToWindow`) is absent.
   - Mode: pre-squash.
   - Criterion: constructive error handling / "no wall without a next move".
   - Rationale for deferral: edge of an edge — the block path itself is the rare
     single-oversized-send case, and a *persistent* failure within it is rarer
     still; Retry covers transient failures and the message is never lost. Adding
     "Send anyway" needs a deliberate truncation-fallback send path. Passes the
     feature-inclusion filter (not needed for alpha, costs build, no gamechanger).
   - Follow-up commitment: build "Send anyway" if alpha testers hit a persistent
     block-compact failure; otherwise revisit at the v0.1.0 release cut.
   - Chris sign-off: ✅ Chris, 2026-06-21 — accepted Liz's recommendation to defer
     when approving the squash.

2. **Marker pill inline-expands the drawer rather than opening a distinct surface.**
   - Surface: `apps/user-client/src/components/chat/CompactionMarker.tsx` (the
     `{open ? <CompactionDrawer/> : null}` inline render).
   - Finding: spec §8 said the marker should "open a drawer rather than expanding
     inline … to avoid astonishing users trained by inline-expand pills". The build
     inline-expands (with a chevron + `aria-expanded`, so it is honest, not
     misdirection — hence soft).
   - Mode: pre-squash.
   - Criterion: least astonishment; spec §8.
   - Rationale for deferral: **conscious deviation, kept on purpose.** The spec's
     "distinct drawer" was Liz's spec-time call; it conflicts with Chris's
     documented inline-over-hidden / expand-in-place preference
     (`feedback_inline_over_hidden_navigation`), which Laura herself flagged. The
     inline-expand is the more house-aligned choice; the spec line is the outlier.
   - Follow-up commitment: re-confirm at the design-language pass; keep inline-expand
     unless a distinct surface reads clearly better in context then.
   - Chris sign-off: ✅ Chris, 2026-06-21 — accepted Liz's recommendation to keep
     inline-expand when approving the squash.

## 2026-06-22 — My Account: Sign out moves one navigation deeper (Logout sub-page)

Raised at Laura's spec-pass of the My Account & Page Bar slice
([[../../superpowers/specs/2026-06-22-my-account-and-page-bar-design]]). Laura ruled
it **HARD** only in the sense that it must be a *conscious, logged* decision — not a
structural block. Decision: accept the depth.

- **Affected flow / surface:** My Account → Logout sub-page (`/app/account/logout`),
  the Sign-out action. Today Sign out lives in the first accordion of `/app/account`;
  the rebuild moves it one navigation deeper, co-located with Delete-local-data.
- **Finding (Laura's summary):** Click-depth for a frequent, benign action: Sign out
  goes from `Entrance Hall → My Account` to `Entrance Hall → My Account → Logout
  sub-page`. Co-locates a repeatable benign action with a rare catastrophic one
  (Delete). Acceptable IF the tile meta + `?` help carry discoverability — but it
  cannot pass silently.
- **Mode:** spec-pass.
- **Criterion:** excessive click-depth for a frequent function; tenet "everything at
  the user's fingertips".
- **Rationale for deferral:** Chris's call — on a single-user, local-first companion
  device, Sign out is a *very* rarely used function (the whole point is persistent
  local encrypted data; signing out means re-authenticating next launch). It belongs
  thematically with the other "leaving" action and has an almost-destructive
  character; burying it slightly so the user does not *accidentally stumble over it*
  is a feature, not a cost. The Logout tile meta states what the page holds, so the
  action is discoverable, not hidden.
- **Follow-up commitment:** Re-evaluate at the v0.1.0 release cut if alpha testers
  report friction reaching Sign out; otherwise the depth stands.
- **Chris sign-off:** ✅ Chris, 2026-06-22 ("Tiefe akzeptieren — sehr, sehr selten
  verwendete Funktion, die thematisch am besten dort hinpasst, hat fast was
  Destruktives; passt, solange der User nicht zufällig drüberstolpert").

## 2026-06-25 — My Integrations: SOFT-2 deferred (SOFT-3 promoted to in-scope)

Raised at Laura's spec-pass of the My Integrations makeover slice
([[../../superpowers/specs/2026-06-25-my-integrations-makeover-design]]). The pass
found **no hard defects**. SOFT-1 (name the badge axis) and SOFT-4 (author the help
body) were folded into the spec, not deferred. **SOFT-3 (silently discarded unsaved
changes) is NOT deferred** — Chris promoted it to in-scope (2026-06-25): built as the
shared `PageScaffold`/`PageBar` dirty-guard (passive `● Unsaved` indicator +
discard-confirm on leave), applied to the Integrations detail page and retrofitted to
the AI Providers detail page (spec §4.5). Only **SOFT-2** remains deferred; Laura
flagged it as "considered hard, defaulting to soft" and asked for a conscious logged
line rather than a silent absorb.

1. **"On by default" moves from one inline tap to enter→toggle→Save→back.**
   - Surface: the MCP server list row (`/app/integrations`) — today's inline
     `onByDefault` checkbox (`McpServersSection.tsx:67-77`, auto-persists) becomes a
     read-only `Default: On/Off` badge; the toggle relocates to the detail page
     behind an explicit Save.
   - Finding: an objective depth increase on a previously one-tap function — the
     textbook shape of a hard finding, defaulted to soft.
   - Mode: spec-pass.
   - Criterion: excessive click-depth; tenet "everything at the fingertips".
   - Rationale for deferral: Chris-decided trade for surface consistency with AI
     Providers (*fewer surface types beats fewer clicks* — memory
     `feedback_simplify_unify_single_surface`). `onByDefault` is a
     **set-once default seed**, not a live switch: the live per-persona arming lever
     is `McpOverrideSection` in the persona editor (`persona-editor.tsx:1026-1032`),
     so the function is not buried, only its default-seed is one tier deeper. The
     cost lands on an infrequent action.
   - Follow-up commitment: re-evaluate at the v0.1.0 release cut if alpha testers
     report friction setting per-server defaults; otherwise the depth stands.
   - Chris sign-off: ✅ Chris, 2026-06-25 — accepted the deferral at spec review
     (set-once default seed; live lever is the per-persona override section).

## 2026-07-02 — Model picker folds ungated proxy providers into the anonymous hidden-count (WS-A spec §10)

- **Affected flow / surface:** The model picker (`ModelPickerOverlay`) and any
  provider-model list that hides offerings whose provider needs the relay when the
  proxy gate is disabled (local-only / offline / server without the `proxy`
  feature).
- **Finding (Laura's summary):** A model whose provider is `requires-proxy` and
  currently ungated is counted into the picker's anonymous `hiddenCount` alongside
  NSFW-filtered and otherwise-unavailable models, rather than being surfaced as a
  distinct, actionable "needs a linked account / relay" bucket the user could act on.
- **Mode:** spec-pass.
- **Criterion:** Disabled-over-hidden / "name the destination"; a hidden capability
  the user could unlock is not individually reachable.
- **Rationale for deferral:** The relay-availability story already has a first-class,
  reachable home — `ServerRelayStatus` on the provider settings surface and the
  gate-driven provider status copy both name the "link an account" next step. The
  model picker's anonymous count is an acceptable interim: no function is
  *unreachable*, only its per-model reason is generic at the picker altitude. A
  dedicated "needs linking" model bucket is additive polish, not a hard defect.
- **Follow-up commitment:** Revisit when the sync/blob workstreams land the fuller
  linked-account UX; if alpha testers with local-only installs report confusion
  about missing models, promote the bucket to a distinct, tappable picker row that
  routes to server linking. Otherwise the anonymous count stands.
- **Chris sign-off:** Not a blocking hard defect — logged per the spec §10 mandate;
  no sign-off required.

---

## 2026-07-02 — WS-C Task 12: dense auto-save editors gate at the container, not per-field

- **Context:** The Class-2 offline sweep (spec §11.2) requires every mutating
  affordance on a synced record to disable (never hide) when a linked account is
  offline. All discrete/destructive affordances are gated per-control with a
  touch-reachable reason: persona delete (Circle), chat rename + delete (History
  row and in-chat topbar), message bookmark (gentle copy), provider remove, MCP
  server edits, document/library delete, seed-template delete, the persona Memory
  buttons (commit/edit/delete/save-body/rollback), and the interrupted-stream
  Retry (which tombstones a synced message).
- **Deferred:** The two DENSE auto-save editors — the persona editor (8 sub-screens,
  dozens of `patch()` field calls via `usePersonaEditing`) and the synced-settings
  toggles/inline-edits (you/web/expert/images) — are NOT greyed field-by-field.
  Instead: `usePersonaEditing.patch` is a guarded no-op offline (no doomed writes),
  the persona hub shows an offline notice, `useUpdateSettings`/`useUpdateChat`
  field-split so device-local edits (adultMode, draftInput, …) stay editable
  offline, and any synced-field write that slips through is caught by React Query
  (mutation error) — never a crash. The ambient `ConnectivityBadge` carries the
  system-level framing.
- **Rationale:** Per-field greying across ~13 files is a large, low-risk surface
  (edits, not destructive actions); the container notice + guard + ambient badge
  cover correctness and framing for the alpha.
- **Follow-up:** Thread a shared "edit disabled" state through the persona-editor
  field components and the synced-settings controls for full per-control greying.
- **Chris sign-off:** Not a blocking hard defect (no dead-end, no data loss, no
  active misdirection — controls visibly do not change offline); logged for Laura's
  pre-squash walk.
