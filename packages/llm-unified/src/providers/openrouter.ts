// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { claudeOpenRouterAdapter } from '../adapters/claude-openrouter.js';
import { openRouterAdapter } from '../adapters/openrouter-openai.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// Reasoning on OpenRouter is the provider's UNIFIED `reasoning` object:
// `{ enabled: true, effort? }` enables, `{ enabled: false }` disables. Probed
// live 2026-05-31 across all curated targets: `{ enabled: false }` is a GENUINE
// off (0 reasoning tokens, empty `reasoning` channel) for every one of them —
// notably GLM-5.1, which is fixed-on on Tensorix/wafer but a clean toggle here
// because OpenRouter's unified param is honoured per route. Effort is modelled
// as a plain on/off toggle (effort buckets are not shown to modulate the trace).
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

// Sonnet 5 is the exception to the plain toggle: probed live 2026-06-30, effort
// genuinely modulates the trace (low ≈ 17 reasoning tokens, high ≈ 270), so it
// is a `steps` control. We mirror the Fable-family shape (off/low/medium/high,
// default medium) rather than exposing the full OpenRouter effort surface
// (xhigh/max) — keeping the cockpit calm and consistent across the Claude family
// (Chris, 2026-06-30).
const SONNET5_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

// OpenAI (ChatGPT) on OpenRouter. The GPT-5 family reasons with a genuinely
// steerable effort surface (probed live 2026-07-06: `reasoning:{enabled:false}`
// is a real off with 0 reasoning tokens, effort low ≈ 4 reasoning tokens, high
// ≈ 165), so a steps control with a real off — same shape as Sonnet 5. The
// reasoning SUMMARY only surfaces behind the top-level `include_reasoning` flag
// (without it the `reasoning` channel is empty even at high effort — unlike
// DeepSeek/GLM, which OpenRouter forwards unprompted); the adapter emits it for
// these offerings. gpt-4o/4.1 have no reasoning at all.
const OPENAI_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};
const OPENAI_NONE: ReasoningControl = { mode: 'none' };

interface OpenRouterOfferingArgs {
  vision: boolean;
  reasoning: ReasoningControl;
  /** Where the model stays smart — drives the context gauge. */
  recommended: number;
  /** Hard ceiling; defaults to `recommended` when the two coincide. */
  max?: number;
  /** When true, the offering enforces ZDR (`provider:{zdr:true}` per request)
   * and records `trust.zdr: true`. Default false — the honest OpenRouter
   * baseline (no project-wide ZDR). */
  zdr?: boolean;
  /** Confidence in the measured behaviour. Defaults to `verified` (a clean live
   * suite run). Set `partial` where a live caveat survives (e.g. an OpenAI route
   * that 404s under our data policy, or a reasoning summary OpenRouter surfaces
   * only stochastically) so the catalogue does not overstate the evidence. */
  confidence?: Offering['confidence'];
}

function openRouterOffering(
  canonicalRef: string,
  slug: string,
  args: OpenRouterOfferingArgs,
): Offering {
  return {
    canonicalRef,
    providerId: 'openrouter',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `openrouter:${slug}` },
    profile: {
      reasoning: args.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: args.vision,
      replayReasoning: false,
    },
    context: { recommended: args.recommended, max: args.max ?? args.recommended },
    // OpenRouter is a US-based router/aggregator. It is NOT ZDR by default and
    // is NOT a TEE: data may transit OpenRouter's US infrastructure, and trust
    // is per-route (each underlying provider has its own policy). We record the
    // honest baseline here — no 🔒 badge unless a specific route enforces ZDR.
    // Jurisdiction US. See the Provider Curation Record. ZDR-enforced offerings
    // (e.g. Grok) flip `trust.zdr` and the adapter sends `provider:{zdr:true}`.
    trust: { tee: false, zdr: args.zdr ?? false, jurisdiction: 'US' },
    // Freedom judgement (Chris, 2026-05-31): freedom-oriented. OpenRouter routes
    // verbatim and adds no censorship layer of its own.
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: args.confidence ?? 'verified',
    serviceKind: 'llm',
  };
}

// Per-canonical slug map resolved from OpenRouter /models (2026-05-31). Context
// `max` is OpenRouter's reported context_length; `recommended` follows our
// project sweet-spots where they differ (DeepSeek V4's 1M ceiling is kept but
// recommended stays at the 200k sweet-spot, matching the wafer offerings).
const offerings: Offering[] = [
  // DeepSeek family — reasoning on `delta.reasoning`, clean toggle (off probed 0).
  openRouterOffering('deepseek-v3.2', 'deepseek/deepseek-v3.2', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 131_072,
  }),
  // DeepSeek V4 Flash/Pro: OpenRouter reports a 1,048,576 ceiling; recommended
  // stays at our 200k DeepSeek-V4 sweet-spot (matches the wafer offerings).
  openRouterOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_048_576,
  }),
  openRouterOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_048_576,
  }),
  // GLM family — 202,752 ceiling on OpenRouter. Both toggle cleanly (GLM-5.1's
  // off is genuine here, unlike Tensorix/wafer where it is fixed-on).
  openRouterOffering('glm-5', 'z-ai/glm-5', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 202_752,
  }),
  openRouterOffering('glm-5.1', 'z-ai/glm-5.1', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 202_752,
  }),
  // Kimi K2.6 — vision-capable, 262,144 ceiling. Reasoning toggles cleanly on
  // OpenRouter (off probed 0), unlike the fixed-on wafer/Tensorix routes.
  openRouterOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
  // Kimi K3 — Moonshot's 2.5T flagship (QAT, native 4-bit). Onboarded 2026-07-16
  // on user demand while open weights are pending; the ONLY OpenRouter route today
  // is Moonshot AI itself (a PRC provider), so freedom is UNKNOWN — the canonical
  // carries `freedomOriented: null` (see canonical-registry), which resolves the
  // 🕊️ badge to unknown regardless of this deployment axis. Vision ✅ (image
  // input), 1,048,576 ceiling; recommended stays at the Kimi-family 262k sweet-spot
  // pending long-context evidence. Reasoning is MANDATORY here: OpenRouter answers
  // `reasoning:{enabled:false}` with HTTP 400 "Reasoning is mandatory for this
  // endpoint and cannot be disabled" (probed live 2026-07-16), and effort does not
  // modulate the trace (low/medium/high all ~50-110 reasoning tokens on the same
  // task), so the honest control is `fixed-on`, not `steps` — the adapter never
  // takes the off branch (`canDisableReasoning` is false). Unlike K2.6 (a clean
  // toggle here), K3 cannot be silenced upstream at all.
  openRouterOffering('kimi-k3', 'moonshotai/kimi-k3', {
    vision: true,
    reasoning: { mode: 'fixed-on' },
    recommended: 262_144,
    max: 1_048_576,
  }),
  // Gemma 4 31B (instruction-tuned) — vision-capable, 262,144 ceiling.
  openRouterOffering('gemma-4-31b', 'google/gemma-4-31b-it', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
  // Qwen3.5 397B A17B — vision-capable, 262,144 ceiling. Reasoning toggle
  // confirmed (off probed 0), consistent with the wafer/nano-gpt finding that it
  // reasons despite some /models metadata claiming otherwise.
  openRouterOffering('qwen3.5-397b-a17b', 'qwen/qwen3.5-397b-a17b', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
  // Grok via OpenRouter — the ZDR path (probed live 2026-06-28). With
  // `provider:{zdr:true}` OpenRouter routes to xAI's Zero-Data-Retention
  // endpoint (HTTP 200, `provider: "xAI"`); reasoning is a clean toggle on the
  // unified `reasoning` object (`enabled:false` is a genuine off, 0 reasoning
  // tokens), tool calls stream fragmented, vision ✅. `recommended` sits at our
  // 200k sweet-spot (xAI roughly doubles price above 200k); `max` is the
  // provider-reported ceiling (4.3: 1M, 4.20: 2M). xAI itself offers no ZDR
  // today, so OpenRouter is the privacy route for Grok — the 🔒 badge lives here.
  openRouterOffering('grok-4.3', 'x-ai/grok-4.3', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_000_000,
    zdr: true,
  }),
  openRouterOffering('grok-4.20', 'x-ai/grok-4.20', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 2_000_000,
    zdr: true,
  }),
  // Grok 4.5 — onboarded 2026-07-15, the day xAI cleared it for the EU. Unlike
  // 4.3/4.20 this is NOT the family toggle: reasoning is mandatory, and
  // OpenRouter says so honestly — `reasoning:{enabled:false}` returns HTTP 400
  // "Reasoning is mandatory for this endpoint and cannot be disabled" (probed
  // live 2026-07-15). Effort buckets are accepted, so the control is `steps`
  // with `offStep: null`: full effort steering, no off. Window 500k (both xAI's
  // own /models and OpenRouter report `context_length: 500000` — deliberate,
  // this is a 1.5T model). ZDR verified live: `provider:{zdr:true}` routes to
  // xAI (HTTP 200, `provider: "xAI"`), so the 🔒 badge is earned, not asserted.
  openRouterOffering('grok-4.5', 'x-ai/grok-4.5', {
    vision: true,
    reasoning: {
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: null,
      defaultStep: 'low',
    },
    recommended: 200_000,
    max: 500_000,
    zdr: true,
  }),
  // Claude Sonnet 5 — the one Claude offering NOT on nano-gpt (Chris, 2026-06-30).
  // OpenRouter reports a 1M context ceiling; recommended stays at our 200k Claude
  // sweet-spot (matches the nano-gpt Claude offerings). Vision ✅, reasoning is a
  // `steps` control (effort modulates — probed live), NOT the family toggle. No
  // ZDR: the honest US-router posture (the user owns the upstream route on their
  // key). The caching-aware adapter (cache_control injection) is bound in
  // `registerOpenRouter` below. Censored at source → CENSORED badge.
  openRouterOffering('claude-sonnet-5', 'anthropic/claude-sonnet-5', {
    vision: true,
    reasoning: SONNET5_STEPS,
    recommended: 200_000,
    max: 1_000_000,
  }),
  // OpenAI (ChatGPT) family via OpenRouter (US router). Onboarded 2026-07-06 on
  // explicit user request; censored at source → CENSORED badge. gpt-4o/4.1 are
  // non-reasoning; the GPT-5 family reasons (steps). Context `max` is OpenRouter's
  // reported ceiling; `recommended` follows our 200k sweet-spot where they differ.
  // The `include_reasoning` flag is bound in registerOpenRouter (OpenRouter gates
  // OpenAI's reasoning summary behind it). No ZDR (honest US-router baseline).
  //
  // Verified live 2026-07-06 (suite): gpt-4o, gpt-4o-2024-11-20 and gpt-4.1 all
  // green. One caveat survives on the GPT-5 family, kept at Chris's call with
  // `confidence: 'partial'` and documented in the Model Curation Record: reasoning
  // HAPPENS (reasoning_tokens, tools, vision, usage all green) but OpenRouter
  // surfaces OpenAI's reasoning SUMMARY only stochastically (re-confirmed on a
  // fully-open account — it is OpenAI's behaviour, not a routing policy), so the
  // visible chain-of-thought is unreliable here (reliable on nano-gpt, which
  // streams the summary natively). Note: gpt-4o-2024-11-20's sole endpoint is
  // OpenAI-direct, so it 404s under a strict OpenRouter account data policy (base
  // gpt-4o falls back to Azure); it routes once the account allows that endpoint —
  // end users with a locked-down OR policy will still 404, so nano-gpt is the
  // reliable route for that checkpoint.
  openRouterOffering('chatgpt-4o', 'openai/gpt-4o', {
    vision: true,
    reasoning: OPENAI_NONE,
    recommended: 128_000,
  }),
  openRouterOffering('chatgpt-4o-2024-11-20', 'openai/gpt-4o-2024-11-20', {
    vision: true,
    reasoning: OPENAI_NONE,
    recommended: 128_000,
  }),
  openRouterOffering('chatgpt-4.1', 'openai/gpt-4.1', {
    vision: true,
    reasoning: OPENAI_NONE,
    recommended: 200_000,
    max: 1_047_576,
  }),
  // GPT-5 family: 'partial' — reasoning works but the visible summary is
  // stochastic on OpenRouter (reliable on nano-gpt). See the Curation Records.
  openRouterOffering('chatgpt-5', 'openai/gpt-5.1', {
    vision: true,
    reasoning: OPENAI_STEPS,
    recommended: 200_000,
    max: 400_000,
    confidence: 'partial',
  }),
  openRouterOffering('chatgpt-5.4', 'openai/gpt-5.4', {
    vision: true,
    reasoning: OPENAI_STEPS,
    recommended: 200_000,
    max: 1_050_000,
    confidence: 'partial',
  }),
  openRouterOffering('chatgpt-5.5', 'openai/gpt-5.5', {
    vision: true,
    reasoning: OPENAI_STEPS,
    recommended: 200_000,
    max: 1_050_000,
    confidence: 'partial',
  }),
];

export const openrouter: ProviderDefinition = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  iconKey: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools'],
  configFields: [apiKeyField('OpenRouter API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // Browser-accessible: the OPTIONS preflight to /api/v1/chat/completions
  // returns 204 with `Access-Control-Allow-Origin: *` and allows Authorization
  // (plus the optional HTTP-Referer / X-Title attribution headers); probed live
  // 2026-05-31. Direct browser calls work — no proxy needed.
  corsHint: 'direct',
  offerings,
  // A US router/aggregator: neither privacy-forward (no default ZDR/TEE) nor a
  // strategic NGO partner, so ranked last, in the router tier alongside
  // nano-gpt (40). 45 (not 30) avoids a tie with ollama-cloud (30) that would
  // make the provider-list order non-deterministic (Chris approved "below the
  // privacy tier"; this honours that without the tie).
  sortPriority: 45,
};

/** Register the OpenRouter provider and its per-offering adapters. */
export function registerOpenRouter(): void {
  registerProvider(openrouter);
  for (const o of offerings) {
    if (o.adapter.kind !== 'catalogue') continue;
    // Claude offerings get the caching-aware adapter (injects Anthropic
    // cache_control); every other offering gets the generic OpenRouter adapter.
    // Branched by canonicalRef, mirroring the nano-gpt registration loop.
    const adapter = o.canonicalRef?.startsWith('claude-')
      ? claudeOpenRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        })
      : openRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
          // Enforce ZDR on the wire for any offering that claims it, so the
          // privacy posture is honoured rather than merely asserted.
          zdr: o.trust.zdr,
          // OpenAI gates its reasoning summary behind include_reasoning; other
          // routes stream it unprompted. Opt in only for the ChatGPT family.
          includeReasoning: o.canonicalRef?.startsWith('chatgpt-') ?? false,
        });
    registerAdapter(o.adapter.adapterId, adapter);
  }
}
