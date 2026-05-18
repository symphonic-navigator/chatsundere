# Security Deferrals — Larissa audit findings

This file logs security findings from Larissa (Opus audit subagent) that I (Liz) consciously deferred rather than fixing before squash. Chris reviews this file at every release cut.

## Entry format

```markdown
## YYYY-MM-DD — Short title

- **Affected paths:** `apps/auth-service/src/...`
- **Finding (Larissa's summary):** Short, faithful paraphrase.
- **Severity:** critical / high / medium / low (Larissa's classification).
- **Rationale for deferral:** Why this is acceptable to ship now.
- **Follow-up commitment:** What I will do, by when (release / milestone).
```

## Ground rules

- Critical and high findings are not deferrable without explicit Chris sign-off in this file.
- Every deferral has a follow-up. "We will think about it" is not a follow-up.
- If a deferral has not been resolved by its committed milestone, it bubbles up to the next release cut for re-evaluation.

---

_(no entries yet)_
