// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelProfile } from '../catalogue/types.js';
import { type BuiltOffering, type HumanOffering, offeringRef } from './model-file.js';

export interface LoopOutcome {
  outcome: 'verified' | 'heuristic-fallback';
  adapterSource: string | null;
  profile: ModelProfile;
}

export interface BuildOfferingArgs {
  human: HumanOffering;
  canonicalId: string;
  runLoop: (human: HumanOffering) => Promise<LoopOutcome>;
}

export interface BuildOfferingResult {
  built: BuiltOffering;
  adapterSource: string | null;
}

export function adapterFileName(canonicalId: string, provider: string): string {
  return `${canonicalId}.${provider}.adapter.ts`;
}

/**
 * Build one offering: run the (injected) synthesis loop, then shape the result
 * into a BuiltOffering. Confidence reflects the loop outcome — verified when the
 * generated adapter reproduced the evidence, heuristic on fallback.
 */
export async function buildOffering(args: BuildOfferingArgs): Promise<BuildOfferingResult> {
  const outcome = await args.runLoop(args.human);
  const adapterFile = adapterFileName(args.canonicalId, args.human.provider);
  return {
    built: {
      ref: offeringRef(args.human.provider, args.canonicalId),
      adapterFile,
      profile: outcome.profile,
      confidence: outcome.outcome === 'verified' ? 'verified' : 'heuristic',
    },
    adapterSource: outcome.adapterSource,
  };
}
