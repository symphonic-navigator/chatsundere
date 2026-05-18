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

## 2026-05-18 — Larissa skipped for monorepo setup unit

- **Affected paths:** `apps/auth-service/**`, `apps/sync-service/**`, `apps/proxy-service/**`, `packages/crypto/**`
- **Finding (Larissa's summary):** _(not run)_
- **Severity:** N/A (no findings exist because no audit was performed)
- **Rationale for deferral:** The "Set up monorepo and tooling" unit touches the four paths in Larissa's scope per CLAUDE.md §9, but every source file in those paths is one of: a Hono application exposing only `/healthz`, `/readyz`, `/metrics`; a Valibot env schema with no secrets; a `prom-client` default-metrics initialiser; a `pino` logger; or a stub function throwing `CryptoError('internal', 'Stub')`. No OPAQUE, no WebAuthn, no JWT issuance, no DB queries, no real cryptography. The audit would have nothing actionable to find.
- **Follow-up commitment:** Larissa runs on the next unit (`Add auth-service`, expected commit subject: "Add auth-service") before that unit's squash, and again on the unit after that (`Add crypto package`). The audit moves with the substance.
