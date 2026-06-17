// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { claudeAdapter, claudeEffortAdapter } from '../adapters/anthropic-claude.js';
import { nanoGptSlugSwapAdapter } from '../adapters/nano-gpt-slug-swap.js';
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
