// SPDX-License-Identifier: AGPL-3.0-only

import { type Offering, listSttOfferings, listTtsOfferings } from '@chatsundere/llm-unified';
import type { ProviderRow } from '../../boot/client-data-db.js';

/** Stable offering reference — the settings persistence format. */
export function offeringRef(o: Offering): string {
  return `${o.providerId}:${o.upstreamSlug}`;
}

/**
 * Curated TTS auto-default order: fewest middlemen first. Mistral Voxtral TTS
 * is deliberately absent — superseded by the board decision 2026-06-12 (its
 * registry entry and transport stay for a possible Mistral comeback).
 */
export const TTS_DEFAULT_ORDER: readonly string[] = ['xai:grok-tts', 'nano-gpt:xai-tts'];

/**
 * Curated STT auto-default order: Mistral first so microphone audio defaults
 * to the EU provider; the xAI paths (US, zdr false) are conscious opt-ins.
 */
export const STT_DEFAULT_ORDER: readonly string[] = [
  'mistral:voxtral-mini-latest',
  'xai:grok-stt',
  'nano-gpt:xai/speech-to-text/v1',
];

export interface SelectedOffering {
  offering: Offering;
  /** True when the slot resolved via the auto-default order (no explicit pick). */
  auto: boolean;
}

function isConfigured(o: Offering, rows: readonly ProviderRow[]): boolean {
  return rows.some((r) => r.templateId === o.providerId && r.enabled);
}

function select(
  all: Offering[],
  order: readonly string[],
  pickedRef: string | null,
  rows: readonly ProviderRow[],
): SelectedOffering | null {
  if (pickedRef) {
    const picked = all.find((o) => offeringRef(o) === pickedRef);
    if (picked && isConfigured(picked, rows)) return { offering: picked, auto: false };
    // Stale pick (provider removed or disabled) — fall through to auto.
  }
  for (const ref of order) {
    const candidate = all.find((o) => offeringRef(o) === ref);
    if (candidate && isConfigured(candidate, rows)) return { offering: candidate, auto: true };
  }
  return null;
}

/** Resolve the active TTS offering from the persisted ref + provider rows. */
export function selectTtsOffering(
  pickedRef: string | null,
  rows: readonly ProviderRow[],
): SelectedOffering | null {
  return select(listTtsOfferings(), TTS_DEFAULT_ORDER, pickedRef, rows);
}

/** Resolve the active STT offering from the persisted ref + provider rows. */
export function selectSttOffering(
  pickedRef: string | null,
  rows: readonly ProviderRow[],
): SelectedOffering | null {
  return select(listSttOfferings(), STT_DEFAULT_ORDER, pickedRef, rows);
}

/** The offerings the Read-aloud-voice slot picker lists, in auto-order. */
export function pickableTtsOfferings(): Offering[] {
  const all = listTtsOfferings();
  return TTS_DEFAULT_ORDER.flatMap((ref) => {
    const match = all.find((o) => offeringRef(o) === ref);
    return match ? [match] : [];
  });
}

/** The offerings the Speech-to-text slot picker lists, in auto-order. */
export function pickableSttOfferings(): Offering[] {
  const all = listSttOfferings();
  return STT_DEFAULT_ORDER.flatMap((ref) => {
    const match = all.find((o) => offeringRef(o) === ref);
    return match ? [match] : [];
  });
}
