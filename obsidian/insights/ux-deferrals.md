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
