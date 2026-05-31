// SPDX-License-Identifier: LGPL-3.0-only
import { registerAdapter } from '../adapter-registry.js';
import { waferAdapter } from '../adapters/wafer-openai.js';
import type { Offering, ReasoningControl } from '../catalogue/types.js';
import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { apiKeyField } from './_helpers.js';

// Reasoning on wafer is the OpenAI-standard `reasoning_effort` param: 'none'
// disables, 'low'|'medium'|'high' enable (probed live 2026-05-31). The effort
// buckets are modelled as a plain on/off toggle rather than discrete steps —
// the honest control unless effort is shown to measurably modulate the trace.
const TOGGLE: ReasoningControl = { mode: 'toggle', defaultOn: true };
// Kimi-K2.6 reasoning cannot be turned off on the adapter path: the live suite
// (makeLiveBinding → waferAdapter — the same path the product uses) emits a
// reasoning trace on EVERY reasoning-off run despite reasoning_effort:'none'
// (2/2 suite runs red on `reasoning-absent`; hand curl probes were oddly silent,
// but the suite is the authoritative end-to-end gate). No reliable off exists
// (enable_thinking:false is a no-op on wafer). Modelled fixed-on — the honest
// "off only hides" case, mirroring nano-gpt's glm-5.
const FIXED_ON: ReasoningControl = { mode: 'fixed-on' };

interface WaferOfferingArgs {
  vision: boolean;
  zdr: boolean;
  reasoning: ReasoningControl;
  /** Where the model stays smart — drives the context gauge. */
  recommended: number;
  /** Hard ceiling; defaults to `recommended` when the two coincide. */
  max?: number;
}

function waferOffering(canonicalRef: string, slug: string, args: WaferOfferingArgs): Offering {
  return {
    canonicalRef,
    providerId: 'wafer',
    upstreamSlug: slug,
    adapter: { kind: 'catalogue', adapterId: `wafer:${slug}` },
    profile: {
      reasoning: args.reasoning,
      toolCalls: { supported: true, streaming: true, concurrentWithReasoning: true },
      vision: args.vision,
      replayReasoning: false,
    },
    context: { recommended: args.recommended, max: args.max ?? args.recommended },
    // ZDR (zero data retention), not TEE. The adapter sends `Wafer-ZDR: required`
    // for these, so the 🔒 badge is truthful: we both can and do request it.
    trust: { tee: false, zdr: args.zdr },
    freedomOrientedDeployment: true, // Chris (2026-05-31): wafer adds no censorship
    source: 'curated',
    confidence: 'verified',
  };
}

const offerings: Offering[] = [
  // --- ZDR-capable flagships (wafer /models, zdr_supported:true) ---
  waferOffering('glm-5.1', 'GLM-5.1', {
    vision: false,
    zdr: true,
    reasoning: TOGGLE,
    recommended: 202_752,
  }),
  // Kimi reasoning-off does not suppress on the adapter path (suite-confirmed) —
  // see FIXED_ON above.
  waferOffering('kimi-k2.6', 'Kimi-K2.6', {
    vision: true,
    zdr: true,
    reasoning: FIXED_ON,
    recommended: 262_144,
  }),
  // Qwen3.5 reasons despite /models claiming reasoning:false — toggle confirmed
  // live (none=off, medium=~4.7k reasoning tokens). The adapter ALWAYS sends an
  // explicit reasoning_effort: omitting it made the model hang (90 s timeout).
  waferOffering('qwen3.5-397b-a17b', 'Qwen3.5-397B-A17B', {
    vision: true,
    zdr: true,
    reasoning: TOGGLE,
    recommended: 262_144,
  }),
  // --- Non-ZDR serverless DeepSeek V4 (zdr_supported:false) ---
  // Serverless, NOT China-routed (Chris 2026-05-31). No ZDR/TEE → no 🔒 badge,
  // but freedom-oriented. wafer exposes a 1M ceiling; recommended stays at our
  // DeepSeek-V4 sweet-spot of 200k (Chris). Reasoning toggle (suite-verified).
  waferOffering('deepseek-v4-flash', 'deepseek-v4-flash', {
    vision: false,
    zdr: false,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_000_000,
  }),
  waferOffering('deepseek-v4-pro', 'deepseek-v4-pro', {
    vision: false,
    zdr: false,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_000_000,
  }),
];

export const wafer: ProviderDefinition = {
  id: 'wafer',
  displayName: 'Wafer',
  iconKey: 'wafer',
  baseUrl: 'https://pass.wafer.ai/v1',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming', 'tools'],
  configFields: [apiKeyField('Wafer API key')],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  // pass.wafer.ai answers an OPTIONS preflight with 405 and emits no
  // Access-Control-* headers (probed 2026-05-31). Our authenticated POST carries
  // custom headers (Authorization + Wafer-ZDR), so the browser requires a
  // preflight that wafer does not honour — direct browser calls are impossible.
  // Routed through the CORS proxy, like ollama-cloud. (Node/Bun — the live
  // conversation-suite — is unaffected: no CORS enforcement server-side.)
  corsHint: 'requires-proxy',
  offerings,
  // Privacy-forward (ZDR) — ranked just after chutes (TEE, the strategic NGO
  // partner) and ahead of the non-privacy aggregators.
  sortPriority: 15,
};

export function registerWafer(): void {
  registerProvider(wafer);
  for (const o of offerings) {
    if (o.adapter.kind === 'catalogue') {
      registerAdapter(
        o.adapter.adapterId,
        waferAdapter(o.upstreamSlug, {
          vision: o.profile.vision,
          zdr: o.trust.zdr,
          reasoning: o.profile.reasoning,
        }),
      );
    }
  }
}
