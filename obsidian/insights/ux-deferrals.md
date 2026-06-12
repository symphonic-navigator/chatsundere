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
