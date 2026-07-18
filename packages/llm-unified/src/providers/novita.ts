// SPDX-License-Identifier: LGPL-3.0-only

import { registerAdapter } from '../adapter-registry.js';
import { novitaReasoningEffortAdapter } from '../adapters/novita-reasoning-effort.js';
import { novitaThinkingAdapter } from '../adapters/novita-thinking.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

const TOGGLE_ON: ReasoningControl = { mode: 'toggle', defaultOn: true };

// The newer novita slugs (Hy3, Kimi K3) steer reasoning via `reasoning_effort`
// with a genuine `none` off-bucket (probed 2026-07-18), so they carry a full
// steps ladder rather than the older enable_thinking toggle.
const EFFORT_STEPS: ReasoningControl = {
  mode: 'steps',
  steps: ['off', 'low', 'medium', 'high'],
  offStep: 'off',
  defaultStep: 'medium',
};
// MiniMax M3 on novita reasons unconditionally — `reasoning_effort` (incl.
// `none`) has no effect, so reasoning cannot be disabled (probed 2026-07-18).
const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

// A live-curated novita offering: hand-written `enable_thinking`-toggle adapter,
// verified. Serves the GLM, DeepSeek, Kimi, Gemma and MiMo families (all disable
// cleanly via enable_thinking on novita).
function thinkingOffering(
  canonicalRef: string,
  slug: string,
  vision: boolean,
  ctx: number,
  // Optional hard ceiling distinct from the recommended window. Defaults to
  // `ctx` (recommended === max). MiMo's 1M ceiling far exceeds the window where
  // it stays smart, so its recommended is capped well below max.
  maxCtx: number = ctx,
): Offering {
  return {
    canonicalRef,
    providerId: 'novita',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `novita:${slug}` },
    profile: {
      reasoning: TOGGLE_ON,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: maxCtx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true, // Chris (2026-05-30): novita adds no censorship
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

// A live-curated novita offering steered by `reasoning_effort` (the newer Hy3,
// Kimi K3 and MiniMax M3 slugs — see `novita-reasoning-effort.ts`). The caller
// passes the probed ReasoningControl: EFFORT_STEPS (off maps to
// `reasoning_effort: 'none'`) or FIXED_ON (MiniMax M3, uncontrollable).
function effortOffering(
  canonicalRef: string,
  slug: string,
  vision: boolean,
  reasoning: ReasoningControl,
  ctx: number,
  maxCtx: number = ctx,
): Offering {
  return {
    canonicalRef,
    providerId: 'novita',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `novita:${slug}` },
    profile: {
      reasoning,
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision,
      replayReasoning: false,
    },
    context: { recommended: ctx, max: maxCtx },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: true, // Chris (2026-05-30): novita adds no censorship
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const thinkingOfferings: Offering[] = [
  thinkingOffering('deepseek-v4-flash', 'deepseek/deepseek-v4-flash', false, 200_000),
  thinkingOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', false, 200_000),
  thinkingOffering('glm-5', 'zai-org/glm-5', false, 200_000),
  thinkingOffering('glm-5.1', 'zai-org/glm-5.1', false, 200_000),
  // GLM 5.2: 1M ceiling (novita /models reports 1,048,576), recommended capped
  // at the 200k smart window. Off via enable_thinking is clean (live-probed
  // 2026-06-17).
  thinkingOffering('glm-5.2', 'zai-org/glm-5.2', false, 200_000, 1_048_576),
  thinkingOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', true, 256_000),
  thinkingOffering('gemma-4-31b', 'google/gemma-4-31b-it', true, 262_144),
  // MiMo: 1M ceiling, recommended capped at 200k (the smart, non-agentic window
  // — ~1000 A4 pages). Omni is vision-capable; Pro is text-only.
  thinkingOffering('mimo-v2.5-omni', 'xiaomimimo/mimo-v2.5', true, 200_000, 1_048_576),
  thinkingOffering('mimo-v2.5-pro', 'xiaomimimo/mimo-v2.5-pro', false, 200_000, 1_048_576),
];

const effortOfferings: Offering[] = [
  // Kimi K3: 2.8T-param flagship, native 1M ceiling (novita reports 1,048,576).
  // recommended stays at the Kimi-family sweet-spot 262 144 (matching the
  // OpenRouter K3 offering — no long-context "stays smart" evidence yet).
  // Vision-capable (text+image). Unlike the fixed-on OpenRouter deployment,
  // novita's `reasoning_effort: 'none'` disables cleanly (probed 2026-07-18) → a
  // full steps ladder with a real off.
  effortOffering('kimi-k3', 'moonshotai/kimi-k3', true, EFFORT_STEPS, 262_144, 1_048_576),
  // Hy3: 295B/21B-active MoE, native 256k context (novita reports 262,144),
  // text-only. Three effort modes plus a clean `none` off-bucket (probed
  // 2026-07-18); recommended capped at the 200k smart window.
  effortOffering('hy3', 'tencent/hy3', false, EFFORT_STEPS, 200_000, 262_144),
  // MiniMax M3: multimodal (text+image), 1M ceiling (novita reports 1,000,000),
  // recommended capped at 200k. Reasoning is uncontrollable here — always on
  // (probed 2026-07-18), hence FIXED_ON.
  effortOffering('minimax-m3', 'minimax/minimax-m3', true, FIXED_ON, 200_000, 1_000_000),
];

const offerings: Offering[] = [...thinkingOfferings, ...effortOfferings];

export const novita: ProviderDefinition = {
  id: 'novita',
  displayName: 'Novita AI',
  iconKey: 'novita',
  baseUrl: 'https://api.novita.ai/v3/openai',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [apiKeyField('Novita AI API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  offerings,
  sortPriority: 20,
};

export function registerNovita(): void {
  registerProvider(novita);
  for (const o of thinkingOfferings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(o.adapter.adapterId, novitaThinkingAdapter(o.upstreamSlug, o.profile.vision));
    }
  }
  for (const o of effortOfferings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        novitaReasoningEffortAdapter(o.upstreamSlug, o.profile.vision, o.profile.reasoning),
      );
    }
  }
}
