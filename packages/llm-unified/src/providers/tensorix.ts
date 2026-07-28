// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { tensorixAdapter } from '../adapters/tensorix-openai.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// Reasoning on Tensorix is the OpenAI-standard `reasoning_effort` param:
// 'low'|'medium'|'high' enable; 'none' disables WHERE THE MODEL HONOURS IT.
// Effort is modelled as a plain on/off toggle (effort does not modulate the
// trace). The per-model control was settled by a deliberate off-leak probe with
// UNIQUE prompts (2026-05-31), NOT by the suite alone — Tensorix response-caches
// identical prompts, which made a repeated reasoning-off prompt look silent
// (cache hit) and masked the real behaviour.
//
// - TOGGLE: 'none' is a genuine off (0/6 leak, unique prompts) — DeepSeek V3.2,
//   DeepSeek V4 Pro, GLM-5.
// - FIXED_ON: 'none' does NOT suppress (6/6 still reason, unique prompts) — the
//   "off only hides" case, exactly like wafer's Kimi. GLM-5.1 and Kimi-K2.6.
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };
const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

interface TensorixOfferingArgs {
  vision: boolean;
  reasoning: ReasoningControl;
  /** Where the model stays smart — drives the context gauge. */
  recommended: number;
  /** Hard ceiling; defaults to `recommended` when the two coincide. */
  max?: number;
}

function tensorixOffering(
  canonicalRef: string,
  slug: string,
  args: TensorixOfferingArgs,
): Offering {
  return {
    canonicalRef,
    providerId: 'tensorix',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `tensorix:${slug}` },
    profile: {
      reasoning: args.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: args.vision,
      replayReasoning: false,
    },
    context: { recommended: args.recommended, max: args.max ?? args.recommended },
    // ZDR (zero data retention), not TEE. Tensorix's ZDR is policy-default and
    // architectural ("ephemeral enclaves", EU-hosted) — never stored, logged, or
    // persisted, per its binding Privacy Policy and Terms — so it is always on
    // (no per-request header, unlike wafer). EU-sovereign (Irish company, Dublin
    // + Helsinki, GDPR Art. 44). The trust basis is policy + EU justiciability,
    // not cryptographic attestation (contrast chutes' TEE). See the Provider
    // Curation Record.
    trust: { tee: false, zdr: true, jurisdiction: 'EU' },
    freedomOrientedDeployment: true, // Chris (2026-05-31): adult-friendly AUP, no censorship added
    source: 'curated',
    confidence: 'verified',
    serviceKind: 'llm',
  };
}

const offerings: Offering[] = [
  // DeepSeek family — Tensorix exposes a 163,840-token input window.
  // V3.2 and V4 Pro have a genuine reasoning toggle (off probed clean, 0/6).
  // DeepSeek V4 Flash is deliberately NOT curated here: on Tensorix it reasons
  // only in bare `content` prose (no `reasoning_content` channel at all, under
  // every switch tried), so it does not fit the channel-based reasoning model
  // and adds nothing over the wafer/nano-gpt/novita V4-Flash offerings, which
  // expose a real channel. See the Provider Curation Record.
  tensorixOffering('deepseek-v3.2', 'deepseek/deepseek-v3.2', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 163_840,
  }),
  tensorixOffering('deepseek-v4-pro', 'deepseek/deepseek-v4-pro', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 163_840,
  }),
  // GLM family — 131,072-token input window on Tensorix. GLM-5 toggles cleanly;
  // GLM-5.1 cannot be silenced (off leaks 6/6) → fixed-on.
  tensorixOffering('glm-5', 'z-ai/glm-5', {
    vision: false,
    reasoning: TOGGLE,
    recommended: 131_072,
  }),
  tensorixOffering('glm-5.1', 'z-ai/glm-5.1', {
    vision: false,
    reasoning: FIXED_ON,
    recommended: 131_072,
  }),
  // GLM 5.2 on Tensorix cannot be silenced either: reasoning_effort:'none' with
  // a UNIQUE prompt leaked a 720-char trace (live-probed 2026-06-17) → fixed-on.
  // Tensorix /models reports no context window; the 131,072 GLM-family input
  // window is carried forward (not re-probed for 5.2).
  tensorixOffering('glm-5.2', 'z-ai/glm-5.2', {
    vision: false,
    reasoning: FIXED_ON,
    recommended: 131_072,
  }),
  // Kimi K2.6 — vision-capable, 262,144-token input window. Reasoning cannot be
  // turned off on Tensorix (off leaks 6/6) → fixed-on (as on wafer).
  tensorixOffering('kimi-k2.6', 'moonshotai/kimi-k2.6', {
    vision: true,
    reasoning: FIXED_ON,
    recommended: 262_144,
  }),
  // Kimi K3 — the fourth route beside OpenRouter, novita and ollama, and the
  // only one of the four where reasoning is BOTH steerable and genuinely
  // silenceable: `reasoning_effort:'none'` yields 0 reasoning chars and 0
  // reasoning_tokens across 6 unique prompts (probed 2026-07-28), unlike K2.6
  // one entry above. Contrast the siblings — OpenRouter refuses to disable it at
  // all (HTTP 400), ollama is fixed-on by policy (tool reliability collapses
  // with reasoning off). Effort does NOT modulate the trace and is therefore not
  // offered as a ladder: across 2 prompts × 3 levels × 3 reps the ranking
  // contradicts itself (P1 `low` 617 chars mean vs `medium` 461; P2 `medium` 770
  // vs `high` 388) and the within-cell spread (up to 1250) exceeds every
  // between-level difference — the same discipline that kept GLM 5.2 off a
  // five-rung ladder. Vision-capable; 1M ceiling with recommended at the
  // Kimi-family 262k sweet-spot, matching the other three routes.
  tensorixOffering('kimi-k3', 'moonshotai/kimi-k3', {
    vision: true,
    reasoning: TOGGLE,
    recommended: 262_144,
    max: 1_048_576,
  }),
];

export const tensorix: ProviderDefinition = {
  id: 'tensorix',
  displayName: 'Tensorix',
  iconKey: 'tensorix',
  baseUrl: 'https://api.tensorix.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools'],
  configFields: [apiKeyField('Tensorix API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // Browser-accessible: the OPTIONS preflight to /v1/chat/completions returns
  // 200 with full Access-Control-* headers (mirrors the Origin, allows the
  // Authorization header; probed live 2026-05-31), so direct browser calls work
  // — unlike wafer, which 405s the preflight.
  corsHint: 'direct',
  offerings,
  // Privacy-forward (EU-sovereign ZDR, always-on per policy). Ranked just after
  // chutes (TEE, the strategic NGO partner) and ahead of wafer (opt-in ZDR) —
  // Chris's call (2026-05-31).
  sortPriority: 12,
};

export function registerTensorix(): void {
  registerProvider(tensorix);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        tensorixAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          reasoning: o.profile.reasoning,
        }),
      );
    }
  }
}
