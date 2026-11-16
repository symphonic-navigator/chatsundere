// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../../src/boot/client-data-db.js';
// Importing the real package registers the builtin providers as a module
// load side-effect — the selector reads the genuine curated catalogue.
import {
  STT_DEFAULT_ORDER,
  type SelectedOffering,
  TTS_DEFAULT_ORDER,
  offeringRef,
  pickableSttOfferings,
  pickableTtsOfferings,
  selectSttOffering,
  selectTtsOffering,
} from '../../../src/lib/voice/select-offering.js';

/** Minimal provider row — the selector only reads templateId + enabled. */
function row(templateId: string, enabled = true): ProviderRow {
  return { templateId, enabled } as ProviderRow;
}

/** Unwrap a selection result without `!` (Biome bans non-null assertions). */
function sel(r: SelectedOffering | null): SelectedOffering {
  if (r === null) throw new Error('expected a selection');
  return r;
}

describe('selectTtsOffering — auto-default order', () => {
  it('prefers xAI direct (fewest middlemen) when all providers are enabled', () => {
    const result = sel(selectTtsOffering(null, [row('xai'), row('nano-gpt'), row('mistral')]));
    expect(offeringRef(result.offering)).toBe('xai:grok-tts');
    expect(result.auto).toBe(true);
  });

  it('falls back to nano-gpt when xAI is not configured', () => {
    const result = sel(selectTtsOffering(null, [row('nano-gpt'), row('mistral')]));
    expect(offeringRef(result.offering)).toBe('nano-gpt:xai-tts');
    expect(result.auto).toBe(true);
  });

  it('never auto-resolves Mistral TTS — mistral-only rows yield null', () => {
    expect(selectTtsOffering(null, [row('mistral')])).toBeNull();
  });
});

describe('selectSttOffering — auto-default order', () => {
  it('prefers Mistral (EU privacy default) over xAI', () => {
    const result = sel(selectSttOffering(null, [row('xai'), row('mistral')]));
    expect(offeringRef(result.offering)).toBe('mistral:voxtral-mini-latest');
    expect(result.auto).toBe(true);
  });

  it('prefers xAI direct over nano-gpt when Mistral is absent', () => {
    const result = sel(selectSttOffering(null, [row('xai'), row('nano-gpt')]));
    expect(offeringRef(result.offering)).toBe('xai:grok-stt');
    expect(result.auto).toBe(true);
  });
});

describe('explicit pick', () => {
  it('wins over the auto order when its provider is enabled', () => {
    const result = sel(selectTtsOffering('nano-gpt:xai-tts', [row('xai'), row('nano-gpt')]));
    expect(offeringRef(result.offering)).toBe('nano-gpt:xai-tts');
    expect(result.auto).toBe(false);
  });

  it('falls back to the auto order when the pick is stale (provider disabled)', () => {
    const result = sel(selectTtsOffering('nano-gpt:xai-tts', [row('xai'), row('nano-gpt', false)]));
    expect(offeringRef(result.offering)).toBe('xai:grok-tts');
    expect(result.auto).toBe(true);
  });
});

describe('pickable lists', () => {
  it('lists TTS offerings in auto-order with Mistral TTS deliberately absent', () => {
    expect(pickableTtsOfferings().map(offeringRef)).toEqual([
      'xai:grok-tts',
      'nano-gpt:xai-tts',
      'elevenlabs:eleven_v4',
      'elevenlabs:eleven_v4_turbo',
      'nano-gpt:elevenlabs/eleven-v4',
      'nano-gpt:elevenlabs/eleven-v4-turbo',
    ]);
  });

  it('lists all four STT offerings in auto-order', () => {
    expect(pickableSttOfferings().map(offeringRef)).toEqual([
      'mistral:voxtral-mini-latest',
      'xai:grok-stt',
      'nano-gpt:xai/speech-to-text/v1',
      'elevenlabs:scribe_v2',
    ]);
  });
});

describe('ElevenLabs in the default orders', () => {
  it('ends the TTS order with the ElevenLabs models, direct then via nano-gpt', () => {
    expect(TTS_DEFAULT_ORDER.slice(-4)).toEqual([
      'elevenlabs:eleven_v4',
      'elevenlabs:eleven_v4_turbo',
      'nano-gpt:elevenlabs/eleven-v4',
      'nano-gpt:elevenlabs/eleven-v4-turbo',
    ]);
  });

  it('ends the STT order with Scribe, Mistral still first', () => {
    expect(STT_DEFAULT_ORDER.at(-1)).toBe('elevenlabs:scribe_v2');
    expect(STT_DEFAULT_ORDER[0]).toBe('mistral:voxtral-mini-latest');
  });

  it('auto-resolves TTS to eleven_v4 with only an ElevenLabs row', () => {
    const result = sel(selectTtsOffering(null, [row('elevenlabs')]));
    expect(offeringRef(result.offering)).toBe('elevenlabs:eleven_v4');
  });
});
