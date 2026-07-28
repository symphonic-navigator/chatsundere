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
    serviceKind: 'llm',
  };
}

// A ZDR verdict has a shelf life, and wafer moves its partition without notice.
// Re-probed 2026-07-28 against `/models` AND a live request per offering, because
// `trust.zdr` is not merely a badge here: the adapter sends `Wafer-ZDR: required`
// whenever it is true, and wafer answers that header with HTTP 422
// `model_zdr_not_supported` on a model that has lost ZDR. A stale `true` does not
// mislabel the offering — it kills it. Both directions had drifted since May.
const offerings: Offering[] = [
  // --- ZDR-capable (wafer /models `zdr_supported:true`, live-confirmed 200) ---
  waferOffering('glm-5.1', 'GLM-5.1', {
    vision: false,
    zdr: true,
    reasoning: TOGGLE,
    recommended: 202_752,
  }),
  // DeepSeek V4 Pro GAINED ZDR since onboarding (was `zdr_supported:false` on
  // 2026-05-31, `true` on 2026-07-28, live-confirmed: the request carrying
  // `Wafer-ZDR: required` answers 200). Serverless, NOT China-routed (Chris
  // 2026-05-31). The upstream slug stayed lower-case-addressable even though
  // /models now lists it as `DeepSeek-V4-Pro` — wafer normalises, so no slug
  // change is needed (probed both spellings). wafer exposes a 1M ceiling;
  // recommended stays at our DeepSeek-V4 sweet-spot of 200k (Chris).
  waferOffering('deepseek-v4-pro', 'deepseek-v4-pro', {
    vision: false,
    zdr: true,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_000_000,
  }),
  // GLM 5.2 — ZDR-capable, 1M ceiling; recommended held at the 200k GLM-5.2
  // sweet-spot the other routes use. Reasoning is a GENUINE toggle here
  // (`reasoning_effort:'none'` → 0 reasoning chars and 0 reasoning_tokens, 0/6
  // unique prompts; `medium` → 3/3 present), which is a per-deployment
  // divergence worth naming: the same model is `fixed-on` on Tensorix, where
  // off only hides.
  waferOffering('glm-5.2', 'GLM-5.2', {
    vision: false,
    zdr: true,
    reasoning: TOGGLE,
    recommended: 200_000,
    max: 1_048_576,
  }),
  // --- Lost ZDR upstream (wafer /models `zdr_supported:false`) ---
  // Kimi K2.6 was ZDR-capable at onboarding; wafer has since decommissioned the
  // backend that carried it (`disabled_reason: self_hosted_backend_decommissioned`,
  // 2026-07-28). It answers normally WITHOUT the header (live-confirmed 200), so
  // the offering stays — it simply loses the 🔒 badge, which is now the honest
  // state. Reasoning-off still does not suppress here — see FIXED_ON above.
  waferOffering('kimi-k2.6', 'Kimi-K2.6', {
    vision: true,
    zdr: false,
    reasoning: FIXED_ON,
    recommended: 262_144,
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
