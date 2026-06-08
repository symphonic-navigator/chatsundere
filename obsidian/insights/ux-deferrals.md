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

_No deferrals yet._
