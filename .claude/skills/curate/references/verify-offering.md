# Mode 3 — Verify / repair an offering (reactive)

Trigger: a model behaves wrongly — "MiMo V2.5 Pro on chutes seems broken",
"users complain about <model> on <provider>", "verify <model>", "a tool call is
failing / reasoning isn't surfacing / streaming is broken". Deliberate, local,
never CI. First read [`catalogue-model.md`](catalogue-model.md) and
[`conventions.md`](conventions.md).

## The flow

1. **Re-run the conversation-suite** against the existing offering. Wire the
   `RunnerBinding` to the offering's current adapter and the provider's key from
   `keys/.{provider}-test-key`, run across the offering's reasoning permutations,
   and render with `renderSuiteReport`. See
   [`conversation-suite.md`](conversation-suite.md) for the mechanics.
2. **Read the red assertions.** The Markdown report names exactly which
   mechanical check failed — e.g. `no-http-error` red on the
   `tool-call-generate-image` turn (the `generate_image` HTTP 400),
   `tool-call-fired:generate_image` red (the model talked instead of calling),
   or `reasoning-absent` red (thinking leaked when asked off).
3. **Diagnose.** Trace the red assertion to its cause: a wrong request-body
   shape, an unhandled provider error envelope, fragmented tool-call arguments
   the adapter dropped (`src/streaming.ts` gets this wrong — see the probe
   checklist in [`model-curation.md`](model-curation.md)), or a provider that
   needs the tool named explicitly in the prompt.
4. **Repair the adapter** `.ts` for the failing fault. Re-run the suite until
   **every** permutation is green.
5. **Update the Model Curation Record** (`obsidian/models/<id>.md`): note what
   broke, the fix, and any new quirk discovered — this is the honesty surface and
   must reflect reality.

The agent's value here is orchestration and diagnosis, not the verdict: the
pass/fail criteria stay mechanical (deterministic assertions), while you work out
*why* a check is red and repair the adapter.
