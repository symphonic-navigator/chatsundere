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
  /** Curated behavioural/formatting steering that travels with the model across
   *  providers — injected as a Band-1 prompt segment (chat + greeting jobs).
   *  See the model-instructions spec (2026-06-12). */
  modelInstructions?: string;
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
  /**
   * Routing override for this offering when it diverges from the provider's
   * corsHint. xAI chat needs the CORS proxy, but its voice endpoints are
   * wildcard-open (probed 2026-06-12) and route direct.
   */
  corsOverride?: 'direct';
  /** Modality this offering provides. */
  serviceKind: ServiceKind;
  /** Capability metadata when `serviceKind === 'web'`; undefined for `llm`. */
  web?: WebOfferingMeta;
  /** Capability metadata when `serviceKind === 'tts'`; undefined otherwise. */
  tts?: TtsOfferingMeta;
  /** Capability metadata when `serviceKind === 'stt'`; undefined otherwise. */
  stt?: SttOfferingMeta;
  /** Capability metadata when `serviceKind === 'tti'`; undefined otherwise. */
  tti?: TtiOfferingMeta;
}

/** How a TTS offering's synthesis request is shaped on the wire. */
export type TtsTransportKind = 'mistral-speech' | 'xai-native' | 'openai-speech';

/** How an STT offering's transcription request is shaped on the wire. */
export type SttTransportKind = 'openai-transcriptions' | 'xai-native';

/** Where a TTS offering's voice list comes from. */
export type TtsVoiceSource =
  | { kind: 'fetch'; endpoint: 'mistral-paginated' | 'xai-flat' }
  | { kind: 'static'; list: ReadonlyArray<{ id: string; name: string }> };

/** Metadata carried by a `serviceKind: 'tts'` offering. */
export interface TtsOfferingMeta {
  displayName: string;
  /**
   * How this provider treats TEAL expression markup in the input text:
   * 'strip' removes the tags before synthesis (provider has no expressive
   * markup support); 'passthrough' sends them verbatim (TEAL v1 is the xAI
   * snapshot, so the xAI offerings pass through natively).
   */
  teal: 'strip' | 'passthrough';
  /**
   * Whether this provider applies content moderation to the input text and may
   * refuse benign passages (e.g. Mistral Voxtral returns 403 on innocuous German
   * such as "eintauchen" — device finding 2026-06-12). Chatsundere's stance is
   * anti-censorship and honest: the UI surfaces this so users are warned, rather
   * than hiding it. `false` for a provider that synthesises whatever it is given.
   */
  contentModerated: boolean;
  /** Wire shape of the synthesis request — see synthesise-speech.ts. */
  transport: TtsTransportKind;
  /** Voice-list source. nano-gpt exposes no voice endpoint, so its Grok
   *  offering carries a static list (probed live 2026-06-12). */
  voices: TtsVoiceSource;
}

/** Metadata carried by a `serviceKind: 'stt'` offering. */
export interface SttOfferingMeta {
  displayName: string;
  /**
   * Whether this provider applies content moderation to transcription input.
   * Unlike Voxtral TTS (which 403s on benign text), the STT endpoint shows no
   * moderation behaviour — kept for symmetry and honesty should that change.
   */
  contentModerated: boolean;
  /** Wire shape of the transcription request — see transcribe-audio.ts. */
  transport: SttTransportKind;
  /**
   * nano-gpt rejects `audio/webm` outright but accepts the identical bytes as
   * `audio/x-matroska` (webm is a restricted MKV profile — chatsune INS-054,
   * re-proven live 2026-06-12). When true, webm blobs are sent spoofed.
   */
  spoofWebmAsMatroska?: boolean;
}

/** Image-generation metadata when `serviceKind === 'tti'`; undefined otherwise. */
export interface TtiOfferingMeta {
  groupId: 'xai-imagine' | 'zimage' | 'seedream' | 'gpt-image-2';
  /** Whether the upstream accepts adult prompts. All launch models: false. */
  canDoNsfw: boolean;
  /** Human-readable model name (TTI offerings have no CanonicalModel). */
  displayName: string;
}

const MODES = new Set(['none', 'fixed-on', 'toggle', 'steps']);

/** Runtime guard used by tests and defensive call-sites. */
export function isReasoningControl(value: unknown): value is ReasoningControl {
  if (typeof value !== 'object' || value === null) return false;
  const mode = (value as { mode?: unknown }).mode;
  return typeof mode === 'string' && MODES.has(mode);
}
