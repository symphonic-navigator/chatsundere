// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ReasoningIntent,
  getOffering,
  getProvider,
  offeringToTarget,
} from '@chatsundere/llm-unified';
import type { IntegrationContext } from '../integrations/types.js';
import type { ToolResult } from '../tools/types.js';
import { initialReasoningState, resolveReasoningBodyExtras } from './reasoning-resolver.js';
import type { SubagentBase } from './subagent-base.js';

/**
 * Resolve the subagent model base for artefact craft (create / modify / inspect).
 * Prefers `ctx.artefactExpert` when set; otherwise the persona offering.
 * Throws if the offering cannot be resolved from the registry.
 */
export function resolveArtefactBase(ctx: IntegrationContext): {
  base: SubagentBase;
  reasoning: ReasoningIntent;
} {
  const ref = ctx.artefactExpert ?? ctx.personaOffering;
  const providerDef = getProvider(ref.providerId);
  const offering = getOffering(ref.providerId, ref.upstreamSlug);
  if (!providerDef || !offering) throw new Error('Artefact author: model not resolvable');
  const control = offering.profile.reasoning;
  const reasoning = (resolveReasoningBodyExtras(control, initialReasoningState(control))
    .reasoning as ReasoningIntent | undefined) ?? { enabled: false };
  return {
    base: {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey: '', // filled by execute (async key fetch)
      target: offeringToTarget(offering),
    },
    reasoning,
  };
}

/** Constructive "artefact expert unreachable" result for create / modify / inspect.
 *  Carries `artefactExpertUnavailable` so the stream-manager can raise an inline note. */
export function artefactExpertUnavailableResult(ctx: IntegrationContext): ToolResult {
  const ref = ctx.artefactExpert;
  const offering = ref ? getOffering(ref.providerId, ref.upstreamSlug) : null;
  const name = offering
    ? `Your artefact expert (${offering.upstreamSlug})`
    : 'Your artefact expert';
  return {
    ok: false,
    output: '',
    error: `${name} isn't reachable right now — unlock its key, or pick a different model under My Settings › "Ask an Expert".`,
    meta: { artefactExpertUnavailable: true },
  };
}
