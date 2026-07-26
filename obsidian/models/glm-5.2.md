# Model Curation Record — GLM 5.2

> Curation record. See [[../providers/chutes]], [[../providers/tensorix]],
> [[../providers/novita]], [[../providers/ollama-cloud]] and
> [[../providers/nano-gpt]] for the shared per-provider mechanics.

- **Identity:** GLM 5.2 · family `glm`
- **T/R/V:** tools ✅ · reasoning ✅ · vision ❌ (text-only)
- **replayReasoning:** false (soft-CoT — never replays its own thinking)
- **🕊️ Freedom:** free — `freedomOriented: true`. The GLM-family freedom
  judgement (Chris, 2026-05-30: z-ai/Zhipu open-weight) carried forward to 5.2;
  every deployment below is `freedomOrientedDeployment: true` except
  ollama-cloud (`null`, not yet assessed), mirroring GLM 5.1.

GLM 5.2 is z-ai's creative/roleplay-marketed flagship (the community reception
that prompted this curation — "z.AI even advertise roleplay"). It is offered on
five providers, each reusing the GLM family's hand-written adapter
(`confidence: 'verified'`). The reasoning *mechanism* differs per provider —
this is why the offerings are not on the generic path. **Behaviourally GLM 5.2
mirrors GLM 5.1 per provider** (probed live 2026-06-17); the one material
difference from 5.1 is the **context window**.

## Context — GLM 5.2 is a 1M-context model

Unlike GLM 5/5.1 (~200k), GLM 5.2 advertises and serves a **1M-token** window.
Measured per provider on 2026-06-17:

- **chutes** `/models` → `context_length: 1 048 576`
- **novita** `/models` → `context_size: 1 048 576`
- **ollama-cloud** `/api/show` → `glm5.2.context_length: 1 000 000`
- **tensorix** + **nano-gpt** `/models` report no window (minimal objects).

Following the **MiMo precedent** (novita MiMo: recommended 200k, max 1M), every
offering sets **`recommended: 200 000`** — the conservative "stays smart" window
carried from the GLM family — and **`max`** at the measured ceiling. Long-context
degradation was **not** probed; 200k recommended errs safe and barely affects the
Context-Gauge in normal companion use. Tensorix keeps the GLM-family
131 072 input window (not re-probed for 5.2); nano-gpt's max is the upstream
zai-org 1M ceiling (inferred — nano-gpt does not report a window).

## Offering — chutes — `toggle` (clean off)

- **slug:** `zai-org/GLM-5.2-TEE` · **adapterId:** `chutes:zai-org/GLM-5.2-TEE`
- **context:** recommended 200 000 / max 1 048 576
- **reasoning control:** symmetric `chat_template_kwargs` toggle (`defaultOn`).
  ON via `enable_thinking: true` (+ `reasoning_effort` forwarded); **OFF via
  `enable_thinking: false` is genuinely off** (0 reasoning tokens, empty channel
  — probed live). Thinking streams on the **`reasoning_content`** channel.
- **tool calls:** streamed **fragmented** (6 SSE events for one call) and
  reassembled by `chutesAdapter`; concurrent with reasoning. valid JSON.
- **usage:** `reasoning_tokens` reported **top-level** in `usage`
  (`prompt_tokens_details: null`); `chutesAdapter` reads the top-level field.
- 🔒 **Privacy:** yes (chutes TEE). 🕊️ free.

## Offering — tensorix — `fixed-on` (reasoning cannot be disabled)

- **slug:** `z-ai/glm-5.2` · **adapterId:** `tensorix:z-ai/glm-5.2`
- **context:** recommended/max 131 072 (Tensorix input window, GLM family)
- **reasoning control:** **`fixed-on`.** `reasoning_effort: 'none'` with a
  **unique** prompt still produced a 720-char trace on `reasoning_content`
  (off-leak probe, 2026-06-17) — the "off only hides" case, exactly like
  GLM 5.1 and Kimi on Tensorix. Modelled `fixed-on` rather than a toggle that
  would falsely promise an off.
- **tool calls:** streamed **fragmented** (5 events) and reassembled; concurrent
  with reasoning. valid JSON.
- **usage:** requested via `stream_options.include_usage`; OpenAI-standard
  (`reasoning_tokens` under `completion_tokens_details`).
- 🔒 **Privacy:** **ZDR** (zero data retention, EU-sovereign, always-on per
  policy). No TEE. See [[../providers/tensorix]]. 🕊️ free.

## Offering — novita — `toggle` (clean off)

- **slug:** `zai-org/glm-5.2` · **adapterId:** `novita:zai-org/glm-5.2`
- **context:** recommended 200 000 / max 1 048 576
- **reasoning control:** top-level boolean **`enable_thinking`** (toggle,
  `defaultOn: true`). `enable_thinking: false` is a genuine off (probed live).
  No granular effort buckets — a toggle, not steps. Thinking on
  `reasoning_content`.
- **tool calls:** single block (1 event), concurrent with reasoning. valid JSON.
- **usage:** `reasoning_tokens` nested under `completion_tokens_details`, cached
  under `prompt_tokens_details`.
- 🔒 **Privacy:** no TEE / no ZDR. 🕊️ free.

## Offering — nano-gpt — `steps` (slug-swap)

- **slug:** `zai-org/glm-5.2` · **adapterId:** `nano-gpt:zai-org/glm-5.2`
- **context:** recommended 200 000 / max 1 048 576 (upstream ceiling, inferred)
- **reasoning control:** **model-slug swap** (steps, `offStep: 'off'`,
  default `medium`). Bare `zai-org/glm-5.2` reasons **not at all** (clean off);
  `zai-org/glm-5.2:thinking` reasons and honours `reasoning_effort`
  (low/medium/high — probed live). Thinking streams on the **`reasoning`** delta
  channel (not `reasoning_content`). Pair registered in
  [[../providers/nano-gpt]]'s `_nano-gpt-pairs.ts`; `nanoGptSlugSwapAdapter`
  derives the `:thinking` slug automatically.
- **tool calls:** single block (1 event), concurrent with reasoning. valid JSON.
- 🔒 **Privacy:** no TEE / no ZDR (bare nano-gpt deployment). 🕊️ free.
- A `TEE/glm-5.2` deployment also exists on nano-gpt; not curated here (separate
  offering, future work — mirrors the GLM 5.1 deferral).

## Offering — ollama-cloud — `steps` (native API)

> **Re-curated 2026-07-26** after a field report ("GLM 5.2 denkt nicht mehr
> nach"). Was `fixed-on`; ollama changed the semantics of `think` underneath us.
> The whole story is in *The 2026-07-26 semantics change* below — it is the
> sharpest instance so far of a provider changing the **meaning** of a request we
> never changed.

- **slug:** `glm-5.2:cloud` · **adapterId:** `ollama-cloud:glm-5.2:cloud`
- **context:** recommended 200 000 / max 1 000 000
- **slug note:** the cloud model is served under the **`:cloud`** suffix. Bare
  `glm-5.2` 404'd at curation time (2026-06-17) but **now resolves** — as of
  2026-07-26 `/api/show` reports an identical deployment for both slugs (756 B
  parameters, 1 M context, `thinking, completion, tools`). We stay on `:cloud`,
  which never stopped working.
- **reasoning control:** **`steps`** — `off / on / max`, `offStep: 'off'`,
  `defaultStep: 'on'`. Each rung maps to a distinct wire value and nothing else
  does: `off` → `think:false`, `on` → `think:true` (the model's own default —
  `on` is not an effort label, so the resolver yields a bare `{enabled:true}`),
  `max` → `think:"max"` verbatim. **Renaming a step therefore changes the wire.**
  Talks to ollama's **native `/api/chat`** (NDJSON) via `ollamaNativeAdapter`,
  NOT the OpenAI-compat shim (the shim makes these reasoning-native models
  re-call the tool after a tool result — GLM 5.1 finding, carried). Reasoning
  streams on the native **`thinking`** field.
- **why three rungs and not five:** ollama also accepts `low` / `medium` /
  `high`, and they were briefly shipped. They **do not separate** — at n=4 × 2
  prompts `high` produced *less* reasoning than `low` on both prompts, with
  heavily overlapping ranges. Only `max` separates cleanly (+47% / +170%). The
  ladder therefore offers exactly what the probes can defend, which also keeps
  the one genuinely useful affordance (`max`) that a plain `toggle` would have
  thrown away. Same discipline as [[inkling]], where seven upstream levels ship
  as four. Laura's pre-squash finding; Chris's call, 2026-07-26.
- **tool calls:** native tool_calls, concurrent with reasoning.
- 🔒 **Privacy:** no TEE / no ZDR. 🕊️ `freedomOrientedDeployment: null` (not yet
  assessed — pending Chris, mirrors GLM 5.1 on ollama).

### The 2026-07-26 semantics change

Reported from the field as "GLM 5.2 denkt nicht mehr nach". It was not a model
regression and not a bug we introduced — **ollama changed what our unchanged
request means.**

The chain:

1. The offering was `fixed-on`, on the then-correct 2026-07-17 finding that
   `think:false` did not stop the reasoning but only relocated it into the answer.
2. A `fixed-on` control makes the cockpit emit **no** reasoning intent
   (`reasoning-resolver.ts`), so `composeWire` falls back to `{enabled:false}`
   and `ollamaNativeAdapter` put **`think:false`** on the wire — every request.
3. Harmless while `false` was a no-op. Then ollama's build-out turned `think`
   into a **validated level** — the server now answers an invalid value with
   `HTTP 400: must be "high", "medium", "low", "max", true, or false` — and the
   trace stopped appearing.
4. The **Grok-4.5 guard of 2026-07-15** ("derive from the offering's own control
   whether an off may reach the wire") existed in the OpenRouter, xAI and
   Anthropic adapters — but had never been ported to `ollama-native.ts`. It is
   now, so no future ollama offering can repeat this.

Re-measured serially, 2 prompts × 6 values × **n=4**, thinking-channel chars
(P1 = a one-line riddle, P2 = the three-switches puzzle):

| `think` | P1 thinking | P2 thinking | P1 eval | P2 eval |
|---|---|---|---|---|
| `false` | **0** | **0** | 83 | 923 |
| `low` | 674 | 1314 | 276 | 612 |
| `medium` | 757 | 2022 | 303 | 840 |
| `high` | 615 | 986 | 252 | 494 |
| `max` | **1213** | **3462** | 434 | 1344 |
| `true` | 994 | 1671 | 394 | 729 |

Two things this table says that the catalogue entry cannot:

- **`low`/`medium`/`high` are noise** — which is why the shipped ladder is
  `off / on / max` and not the five-rung version. `high` lands *below* `low` on
  both prompts; the per-run ranges overlap heavily. Only `max` separates cleanly
  (every one of its four P2 runs exceeded every other value's best run).
- **`off` is not a clean off.** The trace disappears in 8/8 runs, but on the
  *hard* prompt the model still reasons — into the answer text (content 3963
  chars vs ≈1200 with the trace on) at a **higher** eval_count (923) than `low`,
  `medium` or `high`. On the easy prompt it is a genuine saving (83 vs ≈300).
  So the `off` step honestly means *"no visible trace"*, not *"cheaper"*. The
  residue of the old `fixed-on` behaviour is still there on hard inputs — worth
  revisiting if we ever want the Off chip to carry a cost promise.

## Validation

Full conversation-suite live (`makeLiveBinding`, keys under `keys/`,
`curation/run-glm52-suite.ts`) across every reasoning permutation, 2026-06-17 —
no HTTP/stream error, tool fires + valid JSON args, usage normalised, reasoning
present/absent on the correct channel per permutation, memory carried through:

- **chutes** — core **22/22** green (off + on).
- **tensorix** — core **11/11** green (fixed-on; on-only matrix).
- **novita** — core **22/22** green (off + on).
- **nano-gpt** — core **44/44** green (steps: off + low/medium/high).
- **ollama-cloud** — core **11/11** green (fixed-on). ollama.com 503-overloaded
  GLM 5.2 repeatedly; the retry helper rode through five 503s to a clean pass —
  a provider-capacity wobble, not an integration fault (the raw native probe
  streamed `thinking` correctly first).

**Total: 110/110 green** across the five offerings (2026-06-17).

**Re-validated 2026-07-26** after the semantics change, via
`curation/run-ollama-suite.ts` (core + one-shot + sampling-cap per offering):

- **ollama-cloud glm-5.2:cloud** — **63/63** green across all five permutations
  (`reasoning-off`, `effort:low|medium|high|max`); `reasoning-present` green on
  every on-permutation, i.e. the trace is back.
- **ollama-cloud glm-5.1** — **30/30** green (regression check, unchanged).
- **ollama-cloud deepseek-v4-pro** — **30/30** green (regression check, unchanged).

**Total: 123/123 green**, 0 failed.

All offerings text-only (no vision scenario). Entry validated against
`parseCatalogueEntry` (Valibot) — gate green.

## Notes

`family: glm` — GLM 5 and GLM 5.1 also exist across these providers. No lineage
axis (GLM 5 / 5.1 / 5.2 as one logical model) per the data-model design (D6);
`family` gives loose grouping only. See [[glm-5]] and [[glm-5.1]].

GLM 5.2 behaves identically to GLM 5.1 per provider **except** the 1M context
window and the ollama `:cloud` slug — which is why no new adapter was needed; the
five GLM-family adapters were reused unchanged.
