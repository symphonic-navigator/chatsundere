# Spec — Inkling UX surfaces (2026-07-16)

Two small user-client UX units carried in on the back of curating **Inkling**
(Thinking Machines' first model, via nano-gpt). Both are general capabilities,
not Inkling-specific hacks. This document is the **Laura spec-pass** input: it
describes the intended flows and states *before* any code is written.

Context: Inkling on nano-gpt reasons internally (billed `reasoning_tokens`,
scales with difficulty) but nano-gpt's OpenAI-compatible route does **not**
expose the reasoning trace text today — a provider-side wiring gap for this new
model (proven: `zai-org/glm-5.1:thinking` exposes its trace on the very same
route; Inkling does not). nano-gpt's own web UI shows the trace, so the gap is
expected to be fixed within days. We ship honestly in the meantime.

The affordance is a general capability (any offering whose provider withholds the
trace), but today it has exactly **one** consumer: Inkling. Grok 4.5 was expected
to qualify — its `{enabled:false}` path bills reasoning while hiding the trace —
but a live probe (2026-07-16) shows that in its normal fixed-on operation it
**does** surface a reasoning summary on the `reasoning` channel, so it is not a
hidden-trace case and does not carry the flag.

---

## Unit 1 — "Not evaluated" freedom badge

### Today

`FreedomBadge` (`components/ModelTrustBadges.tsx`) renders a badge **only** for
the `'restricted'` freedom state — a loud red "Censored" pill. `'free'` and
`'unknown'` render nothing. `'unknown'` is the effective-freedom result whenever
either the model's `freedomOriented` or the offering's
`freedomOrientedDeployment` is `null` (not yet assessed).

The consequence: a model we have **not yet evaluated** looks identical to a model
we have positively cleared — both show no freedom badge. Absence of a badge reads
as "this is fine", which is not what we know.

### Intended

Make the `'unknown'` state **visible** with its own badge, distinct in tone from
both the red "Censored" danger pill and from any (future) positive all-clear.

- **Scope:** global — every offering whose effective freedom is `'unknown'`, not
  an Inkling-only opt-in. (Chris, 2026-07-16.) Empirically the rare case today:
  in `canonical-registry.ts` exactly one model is `freedomOriented: null`, and
  only `ollama-cloud` carries `freedomOrientedDeployment: null`; every other
  entry is set. So `'unknown'` is the exception and unbadged `'free'` remains the
  common norm — badging `'unknown'` does not clutter the picker.
- **Meaning the badge must convey:** "we have not yet evaluated whether this model
  applies content restrictions" — explicitly about the *freedom / censorship*
  axis, not a generic "unknown".

### Resolved decisions (Laura spec-pass, 2026-07-16)

- **Label: `Uncensored?`** — carries the censorship axis **in the visible label
  text**, parallel to the sibling red `Censored` pill; the `?` carries the
  "pending / not yet checked" meaning. This resolves Laura's two hard defects:
  (a) the axis-meaning must live in the visible label, because the mobile-first
  primary surface (§4, 380 px, touch) has no hover and the `title=` tooltip never
  appears there; (b) `Unrated` is dropped — in a companion with an adult-mode
  axis it reads as "no age gate / anything goes", the opposite of the intent.
- **Tone: slate** (not amber) — amber is the universal caution colour and would
  read as a warning, the false alarm we must avoid. Slate carries no charge.
- **Placement:** the same badge row as Censored / TEE / ZDR / jurisdiction, in
  both `ModelPickerModal` and `ModelPickerOverlay`.
- **Tooltip (desktop enhancement, not the sole carrier):** one honest sentence,
  e.g. *"Not yet evaluated for content restrictions — an independent safety
  evaluation is pending."* The label alone must stand without it.

---

## Unit 2 — Hidden-reasoning affordance

### Today

When a reasoning-capable offering runs with reasoning on, the adapter emits
`reasoning` stream chunks; `MessageBlock` renders them as a reasoning group (the
CoT-reverb inner-monologue surface). The whole affordance assumes trace text
exists.

For an offering that **reasons but whose provider withholds the trace text**
(Inkling today via the nano-gpt gap), there are zero
`reasoning` chunks yet `usage.reasoningTokens > 0`. With no affordance, the user
either sees nothing (looks like reasoning did nothing) or — if we naively showed
the group — an empty, broken-looking bubble. Both violate least-astonishment,
and the second hides that the user is being billed for reasoning.

### Intended

When reasoning ran but no trace text is available, surface a compact, honest,
**non-expandable** marker in the reasoning slot:

> `(hidden reasoning, n tokens)`

- **Trigger:** the offering is flagged `reasoningTraceHidden` **and** the turn
  finished cleanly with a usage event **and** it produced zero reasoning trace
  text **and** `usage.reasoningTokens >= HIDDEN_REASONING_FLOOR`.
- **Copy: `(hidden reasoning, n tokens)`** (Chris, 2026-07-16). Laura's soft
  concern — that "hidden" could read as *the app* withholding rather than the
  provider — is consciously arbitrated away; the spare, factual form is kept.
- **Threshold: `HIDDEN_REASONING_FLOOR` (~100 tokens, a named tunable constant).**
  Below it, no marker. The toggle defaults on, so a trivial "hi" (~24 reasoning
  tokens) would otherwise plant a marker on the focal chat surface every turn;
  the floor keeps trivial turns calm (ND) and shows the marker only when genuine
  reasoning happened. There *is* a real exit — Inkling's reasoning is genuinely
  steerable off (`reasoning:{enabled:false}` → 0 tokens, live-verified) — so the
  marker is never unavoidable.
- **Interrupted / errored turn:** **no marker.** If the stream aborts or errors
  before the usage event, `n` is unknown; we render nothing (the existing
  `StreamInterruptedFooter` owns the failure surface). This forecloses the
  `(hidden reasoning, undefined tokens)` broken-state Laura flagged.
- **Data:** `n` is `usage.reasoningTokens`, which arrives only on the final
  stream event — so the marker settles at end-of-turn (it does not stream in).
- **Persistence:** carried as a widened reasoning content block
  (`{type:'reasoning'; text; hiddenTokens?}`), so it survives reload like any
  other block; no schema/version bump (content blocks are schemaless JSON).
- **Coalescing invariant:** `renderBlocks` joins adjacent reasoning blocks by
  concatenating `.text`. A hidden-marker block is synthesised **only when there
  is no trace text at all**, so it never co-occurs with a real trace block for
  our target (Inkling: no trace at all). A future model
  that emits *partial* trace *plus* hidden tokens is out of scope; if one appears,
  the synthesiser must not merge a marker into a real trace group.
- **Rendering:** styled like a normal reasoning group but visibly *terminal* —
  muted, **no expand chevron** (there is nothing to expand), reads as intentional
  honesty, not a failed load.
- **Unchanged elsewhere:** offerings that *do* surface a trace (GLM, DeepSeek,
  Claude, …) behave exactly as today. When nano-gpt wires Inkling's passthrough,
  we drop its `reasoningTraceHidden` flag and it becomes an ordinary visible
  reasoning toggle with full CoT reverb — no other change.

### Aesthetic intent (from CLAUDE.md §11 + the CoT-reverb decision)

The CoT reverb is deliberately *otherworldly, not human*. A spare, mechanical
"(hidden reasoning, n tokens)" fits that register: it states a fact about the
machine without performing an inner life it cannot show here.

### Resolved (see "Intended" above)

Copy, threshold, and interrupted-turn fallback are all settled (Chris,
2026-07-16). No open taste questions remain.

---

## Not in scope here

- The Inkling catalogue entry, adapter, and Curation Record (that is the /curate
  Mode-2 flow, audited by the conversation-suite, not Laura).
- Any change to how reasoning is *steered* on offerings that already work.

---

## Manual verification (Chris, on device)

**Unit 1 — the badge:**
1. Open the model picker. Inkling shows a muted slate **`Uncensored?`** pill —
   not the red `Censored`, and not absent. Qwen3.5 (the other unassessed model)
   shows it too.
2. A censored model (Claude, ChatGPT) still shows the red `Censored`; a cleared
   model (GLM, DeepSeek) shows **no** freedom pill.

**Unit 2 — the hidden-reasoning marker (select Inkling):**
3. Reasoning **on** (the default). Send something with real depth (a logic
   puzzle). When the reply settles, a muted, **non-expandable**
   `(hidden reasoning, N tokens)` sits at the top of the message — no chevron.
4. Send a trivial `hi`. **No** marker (below the ~100-token floor).
5. Reasoning **off**. Send the depth prompt again. **No** marker (reasoning is
   genuinely disabled — the answer is direct).

**Unit 3 — Inkling itself:**
6. Inkling chats, streams, and calls tools. Vision: upload an image and ask about
   it — it describes it. Note the recorded quirk: offered an image-generation
   tool *and* asked to describe an image, Inkling is tool-eager and may generate
   instead of answering (Model Curation Record documents this).
