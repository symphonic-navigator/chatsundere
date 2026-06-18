# Changelog — Block 1 · Curation

> Archived from `STATUS-CLIENT-ONLY.md` on 2026-06-18 (STATUS reorg).
> Reverse-chronological. Chapter index: [[README]].


## Session log

**Earlier 2026-06-10 (later) — Claude Fable 5 curated on nano-gpt**
(mode-2 `/curate`, inline, squashed on master, **NOT pushed**). Eighth member of
the `claude` family, but mechanically its own animal: **no thinking sibling
slug** — reasoning is a body flag `reasoning: { enabled, effort }` with
**mandatory effort** when on (`{ enabled: true }` alone is a silent no-op,
probed live; the new `claudeEffortAdapter` falls back to `medium`, and the
suite's enabled-without-effort permutation proved the guard live). Steps
control (off/low/medium/high, default medium), **adaptive thinking** (trivial
prompts may skip the trace even at high — expected, not a bug),
`reasoning_tokens` always 0 (rolled into `completion_tokens`), cache
**ENGAGED** (turn-2 cached=11591 ≈ full prefix), vision live-probed. Canonical
`claude-fable-5` is **CENSORED** per the SM-Bench yardstick (run `2adbdf74`:
NSFW-SP 98.62% clears the canary, but Overfit 34.43% / EQ Boundaries 53.65% /
Adversarial 79.51% miss the 90% bar) — criteria now in Liz's memory + the
Model Curation Record [[models/claude-fable-5]]; provider record updated. The
floating `claude-fable-latest` alias deliberately not curated. Validation:
conversation-suite **55/55** + cache check; llm-unified `bun test` 318/0.
Not a Larissa path (no auth/sync/proxy/crypto; no new egress class — existing
nano-gpt route); not a Laura path (no flow change — one more picker entry).
**Device test:** restart `pnpm dev` (packages/* changed), then the six steps in
the record's Manual-verification section. **Next:** unchanged — the
design-language session per the parked round-1 brainstorm.
**Earlier 2026-06-02 — xAI / Grok 4.3 onboarded
(squashed + merged to master `b055e85`, NOT pushed; awaiting Chris's device
test).** Brainstormed end-to-end with Chris, built
subagent-driven in an isolated worktree. New curated provider **`xai`** with one
first-class model **Grok 4.3** (reasoning + **vision** + tools) over
`/chat/completions`. **Live-probed first (empirical truth over docs):** the
encrypted/summarised-reasoning machinery the xAI docs describe is **Responses-API
only**; on chat-completions Grok streams `delta.reasoning_content` that is
**already a readable summary** (270 reasoning-tokens → a one-sentence trace), with
**no opaque encrypted blob** — so reasoning is display-only (`replayReasoning:
false`; Chris's "encrypted-only replay" decision resolves to *no* replay, no blob
exists). Reasoning control is **`steps`** low/medium/high + off (default low,
default-on); `none` is a **clean off** (live-confirmed — not the wafer/Kimi
`fixed-on` leak). The one cross-cutting addition is **conversation-affinity
caching**: a new optional `CanonicalRequest.cacheKey` threaded
stream-engine(`args.chat.id`) → `streamCompletion` → `buildWire` → the adapter,
emitted as the **`x-grok-conv-id`** header only when present (one-shot path
deliberately omits it). Context **recommended 200k / max 1M** (above 200k xAI
~doubles the price → "compact and continue"); `corsHint: requires-proxy` (no CORS
headers); freedom-oriented model + deployment (🕊️), US jurisdiction, **no
TEE/ZDR today** (future NGO-negotiated ZDR is a venice.ai-style possibility —
[[insights/...]]/Records note it). Adapter mirrors `wafer-openai.ts`; client
wired via `built-in-providers.ts` + `ProviderSheet`. **No new `StreamChunk`
variant, no Dexie migration, no new persistence** — only the additive `cacheKey`.
**Not a Larissa change** (llm-unified + client only). **Live conversation-suite
PASS** (`run-xai-suite.ts`, the curation gate): core **44/44** + vision **4/4**,
0 fail — flips the offering to `confidence: 'verified'`. Verification: `pnpm
typecheck` **13/13**; llm-unified `bun test` **248/0**; build **9/9**;
user-client vitest **673 pass / 8 fail** (the unchanged pre-existing
`cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom baseline). Spec/plan:
[[../../../superpowers/specs/2026-06-02-xai-grok-integration-design]],
[[../../../superpowers/plans/2026-06-02-xai-grok-integration]]. Records:
[[providers/xai]], [[models/grok-4.3]]. **Next:** Chris device-tests the 6 manual
steps (spec §9) → Liz pushes the backlog.
**Earlier 2026-06-01 — Claude models live via nano-gpt
(squashed on master `153a926`, NOT pushed; awaiting Chris's device test).**
Seven Claude offerings (Haiku 4.5; Sonnet 4.5/4.6; Opus 4.5/4.6/4.7/4.8) — the
first `freedomOriented:false` models, surfaced with a **CENSORED** badge derived
from `effectiveFreedom='restricted'`. Delivered via **nano-gpt, not OpenRouter**
(OpenRouter's limited-keys path routes Anthropic to Amazon Bedrock → no
`cache_control`; ADR 0032). New deterministic **Anthropic cache-breakpoint
module** (stable-prefix 1h / token-anchored history anchor 1h / rolling tail 5m)
injected by a `claudeAdapter` wrapping the nano-gpt slug-swap adapter; reasoning
is a clean **toggle** (effort does not modulate — live-measured). Signature
replay deferred build-when-needed (no tool-loop consumer). Live-verified: all 7
**22/22 + cache engaged**. Spec/ADR/records:
[[../../../superpowers/specs/2026-06-01-premium-model-integration-design]],
[ADR 0032](../../decisions/0032-premium-censored-models-via-routers.md),
[[models/claude-4]], [[providers/nano-gpt]]. **Manual verification pending:** the
CENSORED badge in the picker + falling prompt cost on a multi-turn Claude chat.
**Earlier 2026-05-31 — MiMo V2.5 Omni + Pro curated on novita
(novita-exclusive).** Xiaomi's open-weight MiMo family — genuinely strong, but
scarce western compute outside China, so novita is the only workable home (Chris).
Two new canonicals (`mimo-v2.5-omni`, `mimo-v2.5-pro`) + two novita offerings, both
reusing the existing `novitaThinkingAdapter` (`enable_thinking` toggle with a clean
off, single-block tool calls, `reasoning_content` channel) — no new adapter.
**Omni** is vision-capable; **Pro** is text-only (novita 400s `image_url` →
"vision not support"). Context **recommended 200k / max 1M** (novita reports a 1M
ceiling; recommended at the smart non-agentic window per Chris) — the novita helper
now carries a separate `maxCtx`. Live suite green: both core permutations 16/16
(on+off) across both models; Omni **vision works** — 100% on real photos, ~88%
(23/26) on the synthetic solid-colour test image (a reasoning-leak artefact of that
image, the Kimi-24px class, not a product fault). `builtins.test` → 8 novita
offerings; `canonical-registry.test` → 10 canonicals. Records:
`models/mimo-v2.5-omni`/`-pro` (new) + `run-novita-mimo-suite.ts`. typecheck +
181 Bun tests green. **Not pushed.**
**Earlier 2026-05-31 — wafer DeepSeek V4 added (flash + pro,
non-ZDR serverless).** Two new wafer offerings on the existing
`deepseek-v4-flash`/`deepseek-v4-pro` canonicals — **non-ZDR** (zdr_supported:false;
no 🔒 badge, no `Wafer-ZDR` header), serverless & not China-routed (Chris).
Reasoning `toggle` with a **clean off** (`reasoning_effort:'none'` → 3/3 silent
incl. with tools — unlike Kimi). Context **recommended 200k / max 1M** (wafer's 1M
ceiling; recommended at our DeepSeek-V4 sweet-spot, Chris) — the offering helper now
carries separate recommended/max. (wafer reports `reasoning_tokens:0` even with a
trace; usage-present holds via total.) Live suite (`deepseek` filter) green;
`builtins.test` → 5 wafer offerings (3 ZDR); the suite runner gained an argv slug
filter. Records: `deepseek-v4-flash`/`-pro` + `providers/wafer` updated. **Not
pushed.**
**Earlier 2026-05-31 — wafer.ai onboarded + 3 ZDR flagship
models curated (GLM-5.1, Kimi-K2.6, Qwen3.5-397B-A17B).** New provider `wafer`
(`https://pass.wafer.ai/v1`, OpenAI chat-completions). Headline: **ZDR** modelled
as an always-on 🔒 trust badge (Chris's call) — the adapter sends
`Wafer-ZDR: required` for ZDR offerings only (non-ZDR models 422 the header).
**Adapter-contract extension:** `WireRequest.headers?` → `transport.extraHeaders`
(merged on the base headers), threaded via `stream-completion`'s new `buildWire`
— general/additive, reusable (e.g. OpenRouter attribution), all existing tests
unchanged. **Empirical findings (probe over docs):** reasoning is OpenAI-standard
`reasoning_effort` (`'none'`=off, low/med/high=on) but effort does **not**
modulate → modelled `toggle`; `Qwen3.5-397B-A17B` reasons despite `/models`
claiming `reasoning:false` → **new canonical** with `requiredCaps.reasoning:true`
(adapter always sends an explicit effort — *omitting* it hung the model 90 s);
`Kimi-K2.6` reasoning cannot be turned off on the adapter path — the live suite
emits a trace on every reasoning-off run despite `reasoning_effort:'none'` (2/2
runs; curl probes oddly silent, but the suite is the authoritative gate) → modelled
**`fixed-on`** (no reliable off; `enable_thinking:false` is a no-op). **CORS:**
wafer answers OPTIONS with 405 / no ACAO → `corsHint: 'requires-proxy'` (Bun-side
suite unaffected). **Live conversation-suite:** GLM-5.1 core 22/22; Qwen3.5 core
22/22 + vision; Kimi-K2.6 vision 4/4 + tools/memory/reasoning-on green (reasoning-off
not offered under `fixed-on`). `sortPriority:15`; `freedomOrientedDeployment:true` (Chris);
Qwen `freedomOriented:null` (pending Chris). Client `settings.tsx` +
`ProviderSheet` gained wafer; `builtins`/`canonical-registry`/`offerings` tests
updated. Records: `providers/wafer.md` + `models/qwen3.5-397b-a17b.md` (new),
`glm-5.1` + `kimi-k2.6` updated. **Not pushed** (ask Chris).
**Earlier 2026-05-31 — chutes reasoning on-switch fixed; the
"hidden reasoning" finding was an adapter bug.** Re-probing the two `reasoning-present`
reds (chutes DeepSeek-V3.2 + Gemma-turbo) overturned the 2026-05-30 premise: both
DO have working `reasoning_content` channels — the `chutesAdapter` just enabled
reasoning with `reasoning_effort`, which GLM/Kimi honour by default (masking the
bug) but DeepSeek-V3.2/Gemma ignore (they reason in bare `content` prose, 0
`reasoning_content` + 0 `reasoning_tokens`). Fix: symmetric `chat_template_kwargs`
toggle — ON `{enable_thinking:true}`, OFF `{enable_thinking:false}`. Effort does
not modulate (flat low/med/high), so **chutes reasoning is now a `toggle`, not
`steps`** (Chris's call). **All 5 chutes offerings live-green** (DeepSeek-V3.2 +
Gemma now pass `reasoning-present`; GLM/Kimi unaffected, no 400; Kimi+Gemma vision
green); nano-gpt + novita glm-5.1 spot-checked green with the new reasoning probe.
The suite's reasoning probe moved off the trivial greeting onto a non-famous
arithmetic word problem (conceptually right; the adapter fix is what cleared the
reds). Insight: [[insights/2026-05-31-chutes-reasoning-on-switch]] (supersedes the
2026-05-30 visibility note). Records + `providers/chutes.md` corrected. 169 src +
34 curation Bun tests green; repo typecheck 13/13. **Not pushed** (ask Chris). A
mid-session modelling spike — a `gemma-4-31b-turbo` canonical — was reverted once
the bug was found; Gemma stays one canonical (reasoning:true).
**Earlier 2026-05-30 — Batch 2: DeepSeek V4 + Kimi + Gemma
curated on nano-gpt & novita; vision suite added.** `deepseek-v4-flash`,
`deepseek-v4-pro`, `kimi-k2.6`, `gemma-4-31b` all live-verified on nano-gpt +
novita (8 new offerings, `heuristic`→`verified`); `glm-5` added to chutes earlier.
**Adapters generalised** (`nanoGptGlmAdapter`→`nanoGptSlugSwapAdapter`,
`novitaGlmAdapter`→`novitaThinkingAdapter`) — one adapter per provider now serves
all four families; dead `genericOffering` removed from nano-gpt/novita (every
offering there is verified). **Vision suite added** (`WireMessage` gained a
multimodal `content` union + `WireToolCall`; `visionScenario` + `assertVisionDescribed`
+ embedded 128x128 test image): Kimi & Gemma vision verified on nano-gpt + novita,
Gemma on chutes too. **Findings:** (1) the vision test image must be ≥~128px —
a 24x24 was mis-perceived as black by Kimi; (2) the chutes off switch is actually
`chat_template_kwargs: { enable_thinking: false }`, **not** `reasoning_effort:'none'`
(which 400s Kimi, esp. with an image) — now FIXED uniformly in `chutesAdapter`, so
chutes Kimi reasoning-off + vision both work (Kimi core 44/44, vision green); (3)
chutes DeepSeek-V3.2 and Gemma emit `reasoning_tokens` but **no `reasoning_content`
text** → `reasoning-present` fails for those two (a visibility characteristic, open
follow-up: model their `reasoning` as visible-or-not). Freedom (Chris, 2026-05-30): DeepSeek/Kimi/Gemma all
`freedomOriented: true`, nano-gpt/novita deployments `true` → 🕊️ free. Records
written/updated for all five. 168 src + 34 curation Bun tests green; repo
typecheck clean. **Prior entry —** GLM family curated across three
providers via `/curate` (first batch). `glm-5` + `glm-5.1` live-verified on
**chutes, nano-gpt, novita** (ollama-cloud out — currently down). Six offerings
now `confidence: 'verified'` with hand-written catalogue adapters: new
`nano-gpt-glm` (slug-swap reasoning) + `novita-glm` (`enable_thinking` toggle)
adapters; `glm-5` added to chutes; `glm-5.1` re-confirmed. **Three heuristics were
wrong and are fixed:** nano-gpt is slug-swap not body-flag; novita's off-switch is
`enable_thinking:false` (the heuristic `reasoning:{enabled}` doesn't disable);
nano-gpt's `glm-5` cannot disable reasoning at all → `fixed-on`. **Suite improved:**
the `memory-echo` turn was flaky (open prompt measured intelligence, not the pipe —
violated D8); now a deterministic recall question, green across all providers.
Freedom (Chris, 2026-05-30): GLM `freedomOriented: true`, nano-gpt + novita
deployments `true` → 🕊️ free. `obsidian/models/glm-5.md` (new) + `glm-5.1.md`
(rewritten) Records. 168 src + 32 curation Bun tests green; repo typecheck clean.
**Runner fix (done):** `WireMessage` gained `tool_calls` (+ `WireToolCall`), and
the suite runner now replays the `assistant(tool_calls)` message and answers every
call with a `tool` result before continuing — well-formed multi-turn history.
Verified live (glm-5.1 on all three providers green). **Prior entry —** Slice 2
shipped: the client is
canonical-first, end-to-end live-verified, and chutes works for real. Four
squash-merged feature commits on master (pushed): (1) **Slice 2 — client
catalogue migration** (`3a31278`): the client moved off `KnownModel`/`knownModels`
onto `CanonicalModel`/`Offering`; model selection is **canonical-first** (pick a
model → pick an offering, top-ranked configured one pre-selected, unconfigured
providers disabled with a CTA); cockpit + reasoning-resolver moved to
`ReasoningControl`; context gauge reads `Offering.context.recommended`; an in-code
canonical registry + per-provider `offerings` + `rankOfferings`/`listOfferings`/
`getOffering`; runtime takes a minimal `CompletionTarget`; persona gained
`canonicalId` (DB v8, clean break); `KnownModel`/`ReasoningCapability` removed.
(2) **Add Chutes to the settings provider list** (`be623a1`): a pre-existing gap —
chutes was registered but the settings UI hard-coded only the three older
providers, so its key could not be entered. (3) **Fix chutes reasoning-off + suite
reasoning assertions** (`6b25ac5`): live-probe found GLM-family models on chutes
reason by default — `reasoning_effort:'none'` is the true off-switch (omitting
does **not** disable); adapter repaired and re-verified e2e via `makeLiveBinding`;
the conversation-suite grew `permutationsForReasoning` so it now catches this
class. (4) **Alias llm-unified to source** (`42d9d2b`): the user-client resolved
llm-unified via stale `dist/`; aliased to TS source so curation/adapter changes are
live in dev without a rebuild. **Manual verification passed on device** (picker,
chutes-TEE pre-select, reasoning off/low/high all live). 168 src + 32 curation Bun
tests green; `pnpm typecheck` 13/13; both builds clean. (8 pre-existing user-client
vitest env failures — `localStorage` jsdom harness in cockpit-draft/chat-page/
chat-route — are unrelated to this work.) The `/curate` Mode 3 flow proved itself:
a real bug, live-diagnosed and repaired.
**Earlier 2026-05-30 — Chutes live-curated; catalogue→runtime Slice 1 wired.**
Three feature units landed on master, all squash-merged:
(1) the **`/curate` skill** (`4dd4f58`); (2) **runtime adapter dispatch — Slice 1**
(`ba26ab4`): `streamCompletion` now routes through a per-model `ModelAdapter` via
an `adapter-registry` when a model carries `adapterId`, gaining correct fragmented
tool-call reassembly, `usage` emission, and a tools-capable `buildRequest`;
adapter-less models keep the byte-identical generic path (`_reasoning-body` +
`parseOpenAiSseStream`); a shared SSE framer (`frameSseEvents`/`eventToTokens`)
backs both; (3) **chutes curation** (`38cd90b`): the `chutes-openai` adapter
factory, the `chutes` provider with 4 TEE models (DeepSeek V3.2, Kimi K2.6, GLM
5.1, Gemma 4 31B Turbo) wired to per-model adapters, the chutes `ProviderScanner`,
a **live conversation-suite `RunnerBinding`** (own fetch → captures HTTP status,
no throw; retries transient 429/5xx), and Curation Records. Provider order now
**chutes < novita < ollama-cloud < nano-gpt**. **Live-validated** against real
chutes: DeepSeek V3.2 20/20 (usage + `generate_image` tool fire + memory all
green); Gemma adapter proven (reasoning-off green incl. tool fire — no
tool-reluctance), reasoning-on hit chutes rate-limiting (429, captured correctly).
173 src + 24 curation Bun tests green; build + typecheck clean. master is 11
commits ahead of origin — **not pushed**.

**Decided today:** the catalogue + per-model `ModelAdapter` layer (and the
`/curate` skill) target a layer that was **not** runtime-wired — the client used
`ProviderDefinition.knownModels` + the generic parser. We decided to **wire it in
three slices**: Slice 1 (runtime adapter dispatch) ✅ done; **Slice 2** (client:
`KnownModel`→`Offering`/`CanonicalModel`; cockpit + reasoning-resolver
`ReasoningCapability`→`ReasoningControl`) and **Slice 3** (catalogue
loading/bundling; registry populated from `Offering.adapter`) remain. Endpoint
rule fixed: always `/chat/completions`, never `/responses` (we hold context).
Specs/plans: [[../../../superpowers/specs/2026-05-30-runtime-adapter-dispatch-design]],
[[../../../superpowers/specs/2026-05-30-chutes-curation-and-live-suite-design]].

**Next session:** options — (a) **Slice 3** (catalogue loading/bundling; the
adapter registry populated from `Offering.adapter` instead of hand-registered in
`registerChutes()`; YAML model files → bundled runtime catalogue); (b) **confirm
reasoning-off for the other chutes models** (DeepSeek V3.2, Kimi K2.6, Gemma) — the
`reasoning_effort:'none'` fix is adapter-level so it should generalise, but only
GLM 5.1 was live-probed; a quick `/curate` verify (now with the suite's reasoning
assertions) closes it; (c) curate more chutes models or another provider via
`/curate`; (d) optional cleanup of the orphaned untracked spike leftovers
(`models/glm-5.1.yaml`, `packages/llm-unified/fixtures/deepseek-v4-pro.fixtures.json`).
Slice 2's two minor follow-ups were both done this session (vite alias, suite
reasoning assertion). master is pushed to origin.

---
**Earlier 2026-05-30 — `/curate` skill landed; synthesis pipeline +
curation CLI retired** (squash `4dd4f58` on master). The fixed-prompt machine
synthesis loop is replaced by an interactive `.claude/skills/curate/` skill in
which Claude authors adapters (one router `SKILL.md` + 7 reference playbooks:
provider-onboarding, model-curation, verify-offering, batch-check,
conversation-suite, + shared catalogue-model/conventions). `src/synthesis/` and
the `src/curate/` CLI driver are deleted; the hand-written `provider-scanner` +
`model-file` moved to `src/providers/curation/`. Adapter verification is now a
deterministic **conversation-suite** (`packages/llm-unified/curation/conversation-suite/`):
pure protocol/mechanical asserts (no intelligence judgement), run **locally,
never in CI** (provider keys never in CI); the suite grows with the
inference-runner (new CLAUDE.md §10 rule). `NormalisedUsage` + a `usage`
`StreamChunk` variant added. Adapters live in `src/adapters/` implementing the
`ModelAdapter` contract (`adapter-contract.ts`); the `nano-gpt-deepseek.baseline`
is the reference. typecheck + build clean; 150 Bun tests green. master is 3
commits ahead of origin — **not pushed yet**. **Next session (with Chris):** play
`/curate` through end-to-end for one provider, then for a model (this is the live
manual verification, needs `NANO_GPT_API_KEY`); confirm the `src/adapters/`
location convention in practice. Spec/plan:
[[../../../superpowers/specs/2026-05-30-curate-skill-design]] /
[[../../../superpowers/plans/2026-05-30-curate-skill]].
**Earlier — 2026-05-29 (evening):** **Curation CLI (model-support factory)**
landed (`c5217b6`) — now retired (see above). Maintainer-only `packages/llm-unified/src/curate/` (not
shipped to clients): one YAML per model (human identity + offerings above,
machine `built:` block below), commands `provider list` / `model list` / `model
template` / `model build [--verify]` / `model report` / `model verify` (stubbed).
`build` probes the target, GLM-5.1 writes a per-offering adapter, validated
**baseline-free** via `validateAgainstFixtures` (structural: reflects the real
evidence + profile-gate; generalises to any target) with self-repair; writes the
adapter as a sibling `.ts`, the `built:` block back (comment-preserving), and a
deterministic report to `obsidian/models/<id>.md`. nano-gpt `ProviderScanner`
tames the `:thinking`/`-thinking`/`TEE/` slug zoo. 188 Bun tests green; typecheck
+ build clean; help + template smoke-tested offline. **Live `build` is Chris's
manual verification** (needs `NANO_GPT_API_KEY`). Tracked deferrals: per-provider
API key (single `NANO_GPT_API_KEY` today — split before a differently-keyed
target), the `--verify` post-build re-probe, `model list` badges, signing/feed,
Ollama catch-all, `model verify` drift. Plan:
[[../../../superpowers/plans/2026-05-29-curation-cli]]. This completes the
provider-integration tooling arc started this morning with the synthesis spike.
**Earlier 2026-05-29 (later):** **Catalogue data model** landed
(`2042be6`). New `packages/llm-unified/src/catalogue/` two-level layer:
`CanonicalModel` (curated identity + T/R/V `requiredCaps` + `freedomOriented`)
groups per-provider `Offering`s, each carrying its own measured `ModelProfile`,
`AdapterRef`, `context {recommended, max}`, `trust` (TEE/ZDR), and
`freedomOrientedDeployment`. Valibot `parseCatalogueEntry` enforces the
capability gate; `effectiveFreedom` is the three-state (free/restricted/unknown)
AND of model + deployment freedom. `ModelProfile` migrated off the spike's shape
— `reasoning` is now the UI-driving `ReasoningControl` union
(none/fixed-on/toggle/steps); context+confidence moved to the Offering. 168
Bun tests green; typecheck + build clean. This is the foundation; the **Curation
CLI** (maintainer factory) is the next plan. Two new specs landed:
[[../../../superpowers/specs/2026-05-29-model-catalogue-data-model-design]] and
[[../../../superpowers/specs/2026-05-29-curation-cli-design]] (plan:
[[../../../superpowers/plans/2026-05-29-catalogue-data-model]]). Provider-integration
strategy decided: model-first curated catalogue + provider-first "Your Endpoints"
for local/uncurated; build-time generation (no signing/feed yet); two badges
(🔒 Privacy, 🕊️ Freedom).
**Earlier today (2026-05-29):** **Agentic adapter-synthesis spike** landed
(squashed at `ac40a3e`). New `packages/llm-unified/src/synthesis/` subsystem:
an analyzer model (GLM-5.1 via nano-gpt) empirically probes a target model,
captures raw SSE fixtures, then writes a per-model adapter — pure `buildRequest`
+ `parseChunk` + declarative `ModelProfile` per the new `adapter-contract.ts` —
accepted only after replay-validation reproduces the captured behaviour AND
matches a hand-ported DeepSeek baseline (which doubles as the validation oracle
and correctly reassembles fragmented streamed tool calls — the case the live
`streaming.ts:112` parser still gets wrong). ≤3 self-repair rounds, then a
conservative heuristic fallback. Generated adapters run in a **Bun Worker**
isolation stand-in (watchdog + teardown) — explicitly NOT the production
security boundary; the production sandboxed-iframe boundary and a Larissa pass
on the execution model are **deferred** follow-ups. The probe suite targets the
empirical unknowns: slug-vs-flag reasoning, effort/`max` acceptance,
off-is-off-vs-hidden (→ `always_on`), streaming-vs-block tool calls,
reasoning+tools concurrency. 155 source Bun tests green (`bunfig.toml` roots the
runner at `./src` so stale `dist/` copies no longer pollute the run); typecheck
+ build clean. **Live run is Chris's manual verification**: `bun run synthesise`
from `packages/llm-unified` with `NANO_GPT_API_KEY` set (see `.env.example`).
Spec: [[../../../superpowers/specs/2026-05-29-agentic-adapter-synthesis-design]];
plan: [[../../../superpowers/plans/2026-05-29-agentic-adapter-synthesis]].
