// SPDX-License-Identifier: LGPL-3.0-only
import type { WebOfferingMeta } from '../integrations/web-interfacing.js';

/** How the user steers reasoning — drives the cockpit UI directly. */
export type ReasoningControl =
  | { mode: 'none' } // UI: always-off, shown disabled
  | { mode: 'fixed-on' } // UI: always-on (incl. "off only hides")
  | { mode: 'toggle'; defaultOn: boolean } // UI: on/off switch
  | { mode: 'steps'; steps: string[]; offStep: string | null; defaultStep: string };

/** Per-offering measured behaviour. (Context + confidence live on the Offering.) */
export interface ModelProfile {
  reasoning: ReasoningControl;
  toolCalls: { supported: boolean; streaming: boolean; concurrentWithReasoning: boolean };
  vision: boolean;
  /** Hard-CoT models replay thinking into history; soft-CoT do not. */
  replayReasoning: boolean;
}

/** Curated, provider-independent identity. What the user picks. */
export interface CanonicalModel {
  id: string;
  displayName: string;
  family: string;
  requiredCaps: { tools: boolean; reasoning: boolean; vision: boolean };
  /** Model-intrinsic freedom; null = not yet assessed. */
  freedomOriented: boolean | null;
  freedomNote?: string;
  notes?: string;
}

export type AdapterRef = { kind: 'catalogue'; adapterId: string } | { kind: 'generic' };

/** A modality a provider contributes, derived from its curated offerings. */
export type ServiceKind = 'llm' | 'web' | 'tts' | 'stt' | 'tti';

/** One upstream endpoint: provider × slug × variant. Curated or discovered. */
export interface Offering {
  canonicalRef: string | null;
  providerId: string;
  upstreamSlug: string;
  adapter: AdapterRef;
  profile: ModelProfile;
  context: { recommended: number; max: number };
  trust: { tee: boolean; zdr: boolean; jurisdiction?: string };
  freedomOrientedDeployment: boolean | null;
  source: 'curated' | 'discovered';
  confidence: 'verified' | 'partial' | 'heuristic';
  /** Modality this offering provides. Currently always 'llm'. */
  serviceKind: ServiceKind;
  /** Capability metadata when `serviceKind === 'web'`; undefined for `llm`. */
  web?: WebOfferingMeta;
}

const MODES = new Set(['none', 'fixed-on', 'toggle', 'steps']);

/** Runtime guard used by tests and defensive call-sites. */
export function isReasoningControl(value: unknown): value is ReasoningControl {
  if (typeof value !== 'object' || value === null) return false;
  const mode = (value as { mode?: unknown }).mode;
  return typeof mode === 'string' && MODES.has(mode);
}
