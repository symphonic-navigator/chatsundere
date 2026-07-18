// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { claudeAdapter, claudeEffortAdapter } from '../adapters/anthropic-claude.js';
import { nanoGptSlugSwapAdapter } from '../adapters/nano-gpt-slug-swap.js';
import { openRouterAdapter } from '../adapters/openrouter-openai.js';
import type {
  Offering,
  ReasoningControl,
  SttOfferingMeta,
  TtiOfferingMeta,
  TtsOfferingMeta,
} from '../catalogue/types.js';
import { registerWebAdapter } from '../integrations/web-adapter-registry.js';
import type { SearchTier, WebOfferingMeta } from '../integrations/web-interfacing.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { nanoGptWebScrapeAdapter, nanoGptWebSearchAdapter } from '../web-adapters/nano-gpt-web.js';
import { apiKeyField } from './_helpers.js';

const STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};
// glm-5.1 on nano-gpt: bare slug is cleanly reasoning-off, `:thinking` honours
// effort → the full steps surface. glm-5 differs: its bare slug reasons
// regardless (probed live), so reasoning cannot be disabled → fixed-on. Both
// share the slug-swap adapter; only the declared control differs.
const GLM_FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

// July 2026 additions on nano-gpt (probed live 2026-07-18): Hy3 has NO
// `:thinking` sibling (tencent/hy3:thinking 404s) and reasoning cannot be truly
// disabled — `reasoning_effort:none` only HIDES the trace while still billing
// reasoning tokens — so a fixed-on control, bound in registerNanoGpt with the
// base slug AS its own thinking slug so the swap never targets a missing
// endpoint. (Nemotron 3 Ultra was probed the same day but deferred: it never
// self-invokes tools under `tool_choice:auto` — which the app always uses — so
// it cannot deliver generate_image. See obsidian/insights/follow-ups-index.md.)
const HY3_NANO_FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

// Mistral on nano-gpt: reasoning is a binary on/off via the `:thinking` slug
// swap (no effort buckets — Mistral's reasoning toggle is binary), so a `toggle`
// rather than `steps`. The bare slug is cleanly reasoning-off and the `:thinking`
// sibling streams thinking on the standard `reasoning` channel — NOT the
// polymorphic content-array Mistral's own API uses (probed live 2026-05-31), so
// the existing nanoGptSlugSwapAdapter handles it unchanged. Large 3 has no
// `:thinking` sibling on nano-gpt → reasoning `none`.
const MISTRAL_TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: false };
const MISTRAL_NONE: ReasoningControl = { mode: 'none' };

// Claude on nano-gpt (the anonymising-router path; OpenRouter is OUT for
// Anthropic — its limited-keys convention routes to Amazon Bedrock, which does
// not honour Anthropic prompt caching. See ADR 0032). Reasoning is a slug swap
// (base = off, the thinking sibling = on); effort does NOT modulate the trace
// (live-probed), so the control is a clean toggle. nano-gpt's Claude thinking
// slugs are inconsistent — the dated Haiku/Sonnet 4.5 use a `-thinking` suffix,
// the rest `:thinking` — so each offering carries its explicit thinking slug.
const CLAUDE_TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

// Grok 4.3/4.5 on nano-gpt steer reasoning via the OpenAI-style `reasoning`
// OBJECT (`{enabled:false}` is a genuine off — 4.3 probed 2026-06-28, 4.5 probed
// 2026-07-09), NOT a slug swap and NOT `reasoning_effort` (`reasoning_effort:none`
// does NOT disable it). The thinking text streams on the `reasoning` channel, so
// the offering reuses the shared unified-reasoning-object adapter
// (openRouterAdapter) rather than the slug-swap one. Default-on, matching xAI's
// own default. Grok 4.20 is NOT offered here: nano-gpt serves only its
// non-reasoning variant (the reasoning sibling slug 404s), so it cannot meet the
// canonical's reasoning capability. Note (4.5): nano-gpt proxies it through xAI's
// Responses API, so an encrypted reasoning blob (`reasoning.encrypted`,
// `xai-responses-v1`) leaks in `reasoning_details`; the adapter reads only the
// `reasoning` summary channel and ignores it → display-only, no replay.
const GROK_TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };

// OpenAI (ChatGPT) on nano-gpt (the anonymising-router path). Reasoning is
// steered by the OpenAI-style unified `reasoning` OBJECT — NOT a slug swap:
// `{enabled:false}` is a genuine off (0 reasoning chars) and `{enabled:true,
// effort}` enables, with the reasoning SUMMARY streaming on the `reasoning`
// channel natively (probed live 2026-07-06). So the GPT-5 family reuses the
// shared unified-reasoning-object adapter (openRouterAdapter), exactly like
// Grok 4.3. Effort genuinely modulates (measured on OpenRouter), so a steps
// control with a real off — mirroring the Sonnet-5/Fable shape for consistency
// across the censored reasoning models. gpt-4o/4.1 have no reasoning at all.
const OPENAI_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};
const OPENAI_NONE: ReasoningControl = { mode: 'none' };

// Inkling's ladder. Deliberately a separate constant from OPENAI_STEPS despite the
// identical shape: the two describe unrelated upstreams that happen to agree today,
// and sharing one would assert a coupling that does not exist. Inkling accepts seven
// effort labels but only these bands are separable — see the offering below.
const INKLING_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

interface ClaudeSpec {
  canonicalRef: string;
  base: string;
  thinking: string;
  /** Hard context ceiling per Anthropic's published window. */
  max: number;
}

const CLAUDE_SPECS: ClaudeSpec[] = [
  {
    canonicalRef: 'claude-haiku-4.5',
    base: 'claude-haiku-4-5-20251001',
    thinking: 'claude-haiku-4-5-20251001-thinking',
    max: 200_000,
  },
  {
    canonicalRef: 'claude-sonnet-4.5',
    base: 'claude-sonnet-4-5-20250929',
    thinking: 'claude-sonnet-4-5-20250929-thinking',
    max: 200_000,
  },
  {
    canonicalRef: 'claude-sonnet-4.6',
    base: 'anthropic/claude-sonnet-4.6',
    thinking: 'anthropic/claude-sonnet-4.6:thinking',
    max: 1_000_000,
  },
  {
    canonicalRef: 'claude-opus-4.5',
    base: 'claude-opus-4-5-20251101',
    thinking: 'claude-opus-4-5-20251101:thinking',
    max: 200_000,
  },
  {
    canonicalRef: 'claude-opus-4.6',
    base: 'anthropic/claude-opus-4.6',
    thinking: 'anthropic/claude-opus-4.6:thinking',
    max: 1_000_000,
  },
  {
    canonicalRef: 'claude-opus-4.7',
    base: 'anthropic/claude-opus-4.7',
    thinking: 'anthropic/claude-opus-4.7:thinking',
    max: 1_000_000,
  },
  {
    canonicalRef: 'claude-opus-4.8',
    base: 'anthropic/claude-opus-4.8',
    thinking: 'anthropic/claude-opus-4.8:thinking',
    max: 1_000_000,
  },
];

const claudeThinkingByBase: Record<string, string> = Object.fromEntries(
  CLAUDE_SPECS.map((s) => [s.base, s.thinking]),
);

// Claude Fable 5 breaks the family pattern: nano-gpt exposes NO thinking
// sibling slug — reasoning is a body flag with MANDATORY effort buckets
// (probed live 2026-06-10; `enabled: true` alone is a silent no-op). Steps
// control with a genuine off, mirroring the DeepSeek V4 shape.
const FABLE_SLUG = 'anthropic/claude-fable-5';
const FABLE_CANONICAL = 'claude-fable-5';
const FABLE_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};

/**
 * A Claude offering on nano-gpt. The model is censored by Anthropic
 * (`canonical.freedomOriented=false`) while nano-gpt routes verbatim
 * (`freedomOrientedDeployment=true`) → effectiveFreedom 'restricted' → CENSORED
 * badge. Uses the dedicated Claude adapter (slug-swap reasoning + Anthropic
 * cache_control injection). 200k recommended sweet-spot; max per Anthropic.
 */
function claudeOffering(spec: ClaudeSpec): Offering {
  return {
    canonicalRef: spec.canonicalRef,
    providerId: 'nano-gpt',
    upstreamSlug: spec.base,
    // Convention: catalogue adapterId is `${providerId}:${upstreamSlug}`. The
    // registration loop decides WHICH adapter to bind (Claude cache adapter vs
    // generic slug-swap) by canonicalRef, not by a distinct id prefix.
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${spec.base}` },
    profile: {
      reasoning: CLAUDE_TOGGLE,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: true,
      // Signature replay deferred (spec §5.2) — no hard-CoT replay wired yet.
      replayReasoning: false,
    },
    context: { recommended: 200_000, max: spec.max },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

// A live-curated nano-gpt offering: hand-written slug-swap adapter, verified.
// Serves the GLM, DeepSeek, Kimi and Gemma families (all slug-swap on nano-gpt).
function slugSwapOffering(
  canonicalRef: string,
  slug: string,
  reasoning: ReasoningControl,
  vision: boolean,
  ctx: number,
  // Optional hard ceiling distinct from the recommended window. Defaults to
  // `ctx` (recommended === max).
  maxCtx: number = ctx,
): Offering {
  return {
    canonicalRef,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${slug}` },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: maxCtx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true, // Chris (2026-05-30): nano-gpt adds no censorship
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

// An OpenAI (ChatGPT) offering on nano-gpt. Censored at source
// (`canonical.freedomOriented=false`) while nano-gpt routes verbatim
// (`freedomOrientedDeployment=true`) → effectiveFreedom 'restricted' → CENSORED
// badge. Reuses the shared unified-reasoning-object adapter (bound in
// registerNanoGpt by the `chatgpt-` branch). Vision + tools across the family.
function openaiOffering(
  canonicalRef: string,
  slug: string,
  reasoning: ReasoningControl,
  ctx: number,
  maxCtx: number = ctx,
): Offering {
  return {
    canonicalRef,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${slug}` },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: true,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: maxCtx },
    // nano-gpt routes to the OpenAI upstream — no ZDR/TEE, US jurisdiction.
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true, // nano-gpt adds no censorship of its own
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const EXA_TIERS: SearchTier[] = [
  { id: 'quick', label: 'Quick', params: { depth: 'auto', numResults: 8 } },
  {
    id: 'neural',
    label: 'Neural',
    tooltip: 'semantic search',
    params: { depth: 'neural', numResults: 8 },
  },
];
const LINKUP_TIERS: SearchTier[] = [
  { id: 'standard', label: 'Standard', params: { depth: 'standard' } },
  { id: 'deep', label: 'Deep', tooltip: 'slower, ~10× the cost', params: { depth: 'deep' } },
];
const BRAVE_TIERS: SearchTier[] = [
  { id: 'standard', label: 'Standard', params: { depth: 'standard' } },
];

function webSearchOffering(slug: string, meta: WebOfferingMeta): Offering {
  return {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${slug}` },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    // Not a chat model — the context-window concept does not apply.
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'web',
    web: meta,
  };
}

function ttiOffering(slug: string, tti: TtiOfferingMeta): Offering {
  return {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: slug,
    adapter: { kind: 'generic' }, // image calls bypass chat adapters entirely
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    // Not a chat model — the context-window concept does not apply.
    context: { recommended: 0, max: 0 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live CORS + generation probes with Chris, 2026-06-09 (spec §10)
    serviceKind: 'tti',
    tti,
  };
}

const ttiOfferings: Offering[] = [
  ttiOffering('z-image-turbo', { groupId: 'zimage', canDoNsfw: false, displayName: 'Z-Image' }),
  ttiOffering('seedream-v4.5', {
    groupId: 'seedream',
    canDoNsfw: false,
    displayName: 'Seedream 4.5',
  }),
  ttiOffering('gpt-image-2', {
    groupId: 'gpt-image-2',
    canDoNsfw: false,
    displayName: 'GPT Image 2',
  }),
];

// nano-gpt's xAI voice wrapper exposes no voice-list endpoint; this static
// list mirrors xAI's five multilingual voices. Lowercase IDs are the canonical
// namespace — both paths accept them (probed live 2026-06-12), so persona
// voice picks survive a path switch.
const GROK_VOICES = [
  { id: 'ara', name: 'Ara' },
  { id: 'eve', name: 'Eve' },
  { id: 'leo', name: 'Leo' },
  { id: 'rex', name: 'Rex' },
  { id: 'sal', name: 'Sal' },
] as const;

const GROK_TTS_META: TtsOfferingMeta = {
  displayName: 'Grok TTS',
  teal: 'passthrough', // nano-gpt forwards xAI expression tags untranslated
  contentModerated: false, // moderation canary passed live 2026-06-12
  transport: 'openai-speech',
  voices: { kind: 'static', list: GROK_VOICES },
  // Same xAI upstream — same bass-heavy characteristic; 50 Hz high-pass recommended.
  defaultHighpassHz: 50,
};

const GROK_STT_META: SttOfferingMeta = {
  displayName: 'Grok STT',
  contentModerated: false,
  transport: 'openai-transcriptions',
  spoofWebmAsMatroska: true, // INS-054: webm 400s, identical bytes pass as MKV
};

const webOfferings: Offering[] = [
  webSearchOffering('web-linkup', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['recommended', 'ai'],
    searchTiers: LINKUP_TIERS,
  }),
  webSearchOffering('web-exa', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['ai', 'neural'],
    searchTiers: EXA_TIERS,
  }),
  webSearchOffering('web-brave', {
    canSearch: true,
    canFetch: false,
    requiresProxy: true,
    traits: ['privacy'],
    searchTiers: BRAVE_TIERS,
  }),
  webSearchOffering('web-scrape', {
    canSearch: false,
    canFetch: true,
    requiresProxy: true,
    traits: [],
  }),
];

const offerings: Offering[] = [
  slugSwapOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', STEPS, false, 200_000),
  slugSwapOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', STEPS, false, 200_000),
  slugSwapOffering('glm-5', 'zai-org/glm-5', GLM_FIXED_ON, false, 200_000),
  slugSwapOffering('glm-5.1', 'zai-org/glm-5.1', STEPS, false, 200_000),
  // GLM 5.2: bare slug is cleanly reasoning-off, `:thinking` honours effort →
  // the full steps surface (live-probed 2026-06-17, reasoning on the `reasoning`
  // channel). 1M ceiling from the upstream zai-org model; recommended capped at
  // 200k (nano-gpt /models reports no window).
  slugSwapOffering('glm-5.2', 'zai-org/glm-5.2', STEPS, false, 200_000, 1_048_576),
  slugSwapOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', STEPS, true, 256_000),
  slugSwapOffering('gemma-4-31b', 'google/gemma-4-31b-it', STEPS, true, 262_144),
  // --- Freedom additions, July 2026 (probed live 2026-07-18) ---
  // Hy3: 295B/21B-active Tencent MoE, text-only, native 256k. fixed-on — no
  // `:thinking` sibling and no true off (bound to the base slug in
  // registerNanoGpt). Recommended capped at the 200k smart window.
  slugSwapOffering('hy3', 'tencent/hy3', HY3_NANO_FIXED_ON, false, 200_000, 262_144),
  // MiniMax M3: slug-swap reasoning (bare = off, `:thinking` = on). Multimodal
  // (text+image) — vision confirmed live 2026-07-18. 1M ceiling, recommended
  // capped at 200k.
  slugSwapOffering('minimax-m3', 'minimax/minimax-m3', STEPS, true, 200_000, 1_000_000),
  // Mistral family on nano-gpt (anonymous-router path). Small 4 and Medium 3.5
  // have `:thinking` siblings → binary toggle; Large 3 has none → no reasoning.
  // Vision is supported across the family (matches the direct-Mistral offerings).
  slugSwapOffering(
    'mistral-small-4',
    'mistralai/mistral-small-4-119b-2603',
    MISTRAL_TOGGLE,
    true,
    262_144,
  ),
  slugSwapOffering(
    'mistral-medium-3-5',
    'mistral/mistral-medium-3.5',
    MISTRAL_TOGGLE,
    true,
    262_144,
  ),
  slugSwapOffering(
    'mistral-large-3',
    'mistralai/mistral-large-3-675b-instruct-2512',
    MISTRAL_NONE,
    true,
    262_144,
  ),
  ...CLAUDE_SPECS.map(claudeOffering),
  {
    canonicalRef: FABLE_CANONICAL,
    providerId: 'nano-gpt',
    upstreamSlug: FABLE_SLUG,
    adapter: { kind: 'catalogue', adapterId: `nano-gpt:${FABLE_SLUG}` },
    profile: {
      reasoning: FABLE_STEPS,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: true,
      // Signature replay deferred like the rest of the family (spec §5.2);
      // Fable accepts unsigned thinking replay, so wiring it later is cheap.
      replayReasoning: false,
    },
    // 200k sweet-spot like the family; 1M hard ceiling per Anthropic's window.
    context: { recommended: 200_000, max: 1_000_000 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  },
  // Grok 4.3 via nano-gpt (the anonymising-router path). Reasoning is a clean
  // toggle on the unified `reasoning` object; tool calls arrive single-block.
  // nano-gpt routes to the xAI upstream → no ZDR/TEE, US jurisdiction.
  {
    canonicalRef: 'grok-4.3',
    providerId: 'nano-gpt',
    upstreamSlug: 'x-ai/grok-4.3',
    adapter: { kind: 'catalogue', adapterId: 'nano-gpt:x-ai/grok-4.3' },
    profile: {
      reasoning: GROK_TOGGLE,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: true,
      replayReasoning: false,
    },
    context: { recommended: 200_000, max: 1_000_000 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true, // Chris (2026-05-30): nano-gpt adds no censorship
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  },
  // Grok 4.5 via nano-gpt (the anonymising-router path). Tool calls arrive
  // single-block when fired. Two route quirks are documented but non-blocking:
  // nano-gpt occasionally lets the model emit the tool call as markdown text
  // rather than firing it (the known DSv4-Flash-style nondeterminism), and
  // `tool_choice: 'required'` errors on this route (we never send it). nano-gpt
  // routes to the xAI upstream → no ZDR/TEE, US jurisdiction.
  //
  // CORRECTED 2026-07-15 (was `GROK_TOGGLE`, max 1M). Grok 4.5 reasoning is
  // MANDATORY on every route — xAI-direct rejects `reasoning_effort: 'none'`
  // with HTTP 400 and OpenRouter answers "Reasoning is mandatory for this
  // endpoint and cannot be disabled". nano-gpt neither errors nor obeys: it
  // ACCEPTS `{enabled:false}`, hides the trace and reports
  // `reasoning_tokens: 0` while the model reasons anyway and the user is billed
  // for it (probed 2026-07-15: a one-token answer "7" cost 198 completion
  // tokens). The 2026-07-09 curation read that fabricated counter as a genuine
  // off — it is the textbook "off only hides" case, so the control is
  // `fixed-on` and no off is offered. Window corrected to the real 500k, which
  // xAI's own /models and OpenRouter both report (the 1M was mirrored from 4.3
  // because nano-gpt reports no window of its own).
  {
    canonicalRef: 'grok-4.5',
    providerId: 'nano-gpt',
    upstreamSlug: 'x-ai/grok-4.5',
    adapter: { kind: 'catalogue', adapterId: 'nano-gpt:x-ai/grok-4.5' },
    profile: {
      reasoning: { mode: 'fixed-on' },
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: true,
      replayReasoning: false,
    },
    context: { recommended: 200_000, max: 500_000 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true, // Chris (2026-05-30): nano-gpt adds no censorship
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  },
  // Inkling via nano-gpt (routed to Baseten) — Thinking Machines' first public
  // model. Reasoning is a genuine toggle on the unified `reasoning` object
  // (`{enabled:false}` → 0 reasoning tokens; default on; scales with difficulty —
  // live-probed 2026-07-16). Tool calls arrive single-block; vision works.
  // Reasoning is a genuine `steps` ladder on the unified reasoning object:
  // `{enabled:false}` is a real off (0 reasoning tokens) and `effort` modulates
  // roughly tenfold from low to high (re-probed 2026-07-17). Inkling's own card
  // documents seven upstream levels (none/minimal/low/medium/high/xhigh/max), but
  // only four bands are empirically separable — minimal≈low, xhigh≈high, and max
  // measured BELOW high — so we ship the house-style four and under-claim rather
  // than offer positions that do nothing. Context window unconfirmed (nano-gpt
  // /models reports none; HF card unspecified) — conservative 128k pending
  // confirmation. Baseten upstream → no ZDR/TEE, US jurisdiction. Freedom not yet
  // assessed → the "Uncensored?" badge.
  {
    canonicalRef: 'inkling',
    providerId: 'nano-gpt',
    upstreamSlug: 'thinkingmachines/inkling',
    adapter: { kind: 'catalogue', adapterId: 'nano-gpt:thinkingmachines/inkling' },
    profile: {
      reasoning: INKLING_STEPS,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: true,
      replayReasoning: false,
    },
    context: { recommended: 131_072, max: 131_072 },
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true, // nano-gpt adds no censorship of its own
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  },
  // OpenAI (ChatGPT) family via nano-gpt (anonymising-router path). Onboarded
  // 2026-07-06 on explicit user request; CENSORED badge. gpt-4o/4.1 non-reasoning,
  // GPT-5 family reasons via the unified `reasoning` object (steps).
  openaiOffering('chatgpt-4o', 'openai/gpt-4o', OPENAI_NONE, 128_000),
  openaiOffering('chatgpt-4o-2024-11-20', 'openai/gpt-4o-2024-11-20', OPENAI_NONE, 128_000),
  openaiOffering('chatgpt-4.1', 'openai/gpt-4.1', OPENAI_NONE, 200_000, 1_047_576),
  openaiOffering('chatgpt-5', 'openai/gpt-5.1', OPENAI_STEPS, 200_000, 400_000),
  openaiOffering('chatgpt-5.4', 'openai/gpt-5.4', OPENAI_STEPS, 200_000, 1_048_576),
  openaiOffering('chatgpt-5.5', 'openai/gpt-5.5', OPENAI_STEPS, 200_000, 1_048_576),
  ...webOfferings,
  ...ttiOfferings,
  // Grok TTS via nano-gpt's xAI wrapper — text-to-speech; bypasses the chat
  // adapter entirely. Routes through nano-gpt's OpenAI-shaped speech endpoint.
  {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: 'xai-tts',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    // nano-gpt routes to the xAI upstream — trust reflects that upstream.
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live probes 2026-06-12: synthesis, canary, TEAL passthrough
    serviceKind: 'tts',
    tts: GROK_TTS_META,
  },
  // Grok STT via nano-gpt's xAI wrapper — speech-to-text.
  {
    canonicalRef: null,
    providerId: 'nano-gpt',
    upstreamSlug: 'xai/speech-to-text/v1',
    adapter: { kind: 'generic' },
    profile: {
      reasoning: { mode: 'none' },
      toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 0, max: 0 },
    // nano-gpt routes to the xAI upstream — trust reflects that upstream.
    trust: { tee: false, zdr: false, jurisdiction: 'US' },
    freedomOrientedDeployment: true,
    source: 'curated',
    confidence: 'verified', // live probes 2026-06-12: MP3/WAV pass; webm needs the MKV spoof
    serviceKind: 'stt',
    stt: GROK_STT_META,
  },
];

export const nanoGpt: ProviderDefinition = {
  id: 'nano-gpt',
  displayName: 'nano-gpt',
  iconKey: 'nano-gpt',
  baseUrl: 'https://nano-gpt.com/api/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('nano-gpt API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'inofficial',
  offerings,
  sortPriority: 40,
};

export function registerNanoGpt(): void {
  registerProvider(nanoGpt);
  for (const o of offerings) {
    if (o.adapter.kind !== 'catalogue') continue;
    if (o.serviceKind === 'web') continue;
    if (o.serviceKind === 'tti') continue;
    if (o.canonicalRef === FABLE_CANONICAL) {
      registerAdapter(
        o.adapter.adapterId,
        claudeEffortAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    } else if (o.canonicalRef?.startsWith('claude-')) {
      registerAdapter(
        o.adapter.adapterId,
        claudeAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
          thinkingSlug: claudeThinkingByBase[o.upstreamSlug] ?? `${o.upstreamSlug}:thinking`,
        }),
      );
    } else if (o.canonicalRef?.startsWith('grok-')) {
      // Grok on nano-gpt honours the unified `reasoning` object (not slug-swap),
      // so it reuses the shared unified-reasoning-object adapter. No ZDR here.
      registerAdapter(
        o.adapter.adapterId,
        openRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    } else if (o.canonicalRef?.startsWith('chatgpt-')) {
      // OpenAI on nano-gpt honours the unified `reasoning` object (like Grok) and
      // surfaces its reasoning summary natively, so it reuses the shared adapter.
      // No `include_reasoning` flag needed here — that gate is OpenRouter-only.
      registerAdapter(
        o.adapter.adapterId,
        openRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    } else if (o.canonicalRef === 'hy3') {
      // Hy3 has no `:thinking` sibling on nano-gpt and cannot disable reasoning,
      // so bind the base slug as its own thinking slug: a fixed-on model that
      // always reasons on the base endpoint (reasoning_effort left unset).
      registerAdapter(
        o.adapter.adapterId,
        nanoGptSlugSwapAdapter(
          o.upstreamSlug,
          o.profile.vision,
          o.profile.reasoning,
          o.upstreamSlug,
        ),
      );
    } else if (o.canonicalRef === 'inkling') {
      // Inkling honours the unified `reasoning` object — `{enabled:false}` is a
      // genuine off and `effort` modulates — so it reuses the shared adapter and
      // streams its trace unprompted (no `include_reasoning` gate; that is
      // OpenRouter-only). We bind the BASE slug on purpose: `:thinking` differs
      // only in its default (base defaults reasoning off, `:thinking` on) and both
      // honour explicit steering, so with the adapter always sending an explicit
      // reasoning object the two are behaviourally identical. Re-probed 2026-07-17.
      registerAdapter(
        o.adapter.adapterId,
        openRouterAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    } else {
      registerAdapter(
        o.adapter.adapterId,
        nanoGptSlugSwapAdapter(o.upstreamSlug, o.profile.vision, o.profile.reasoning),
      );
    }
  }

  const searchProviderBySlug: Record<string, 'linkup' | 'exa' | 'brave'> = {
    'web-linkup': 'linkup',
    'web-exa': 'exa',
    'web-brave': 'brave',
  };
  for (const o of webOfferings) {
    if (o.adapter.kind !== 'catalogue') continue;
    if (o.web?.canFetch) {
      registerWebAdapter(o.adapter.adapterId, () => nanoGptWebScrapeAdapter());
    } else {
      const sp = searchProviderBySlug[o.upstreamSlug];
      // Fail fast: a search offering whose slug is not mapped would otherwise
      // register no adapter and silently never resolve.
      if (!sp) throw new Error(`nano-gpt: unmapped web search slug "${o.upstreamSlug}"`);
      registerWebAdapter(o.adapter.adapterId, () => nanoGptWebSearchAdapter(sp));
    }
  }
}
