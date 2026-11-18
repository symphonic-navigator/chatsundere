// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  LIVE_VOICE_TOOLTIP,
  VOICE_NOTE,
  voiceRepairFor,
} from '../../../src/lib/voice/voice-repair.js';

const ret = '/app/chat/c1?x=1';
const enc = encodeURIComponent(ret);

describe('voiceRepairFor', () => {
  it('no-provider → Set up voice, to Settings → Voice with the return', () => {
    expect(voiceRepairFor('no-provider', 'p1', ret)).toEqual({
      label: 'Set up voice',
      to: `/app/settings/voice?return=${enc}`,
    });
  });

  it("no-voice → Choose a voice, to the persona's Font & Voice page with the return", () => {
    expect(voiceRepairFor('no-voice', 'p1', ret)).toEqual({
      label: 'Choose a voice',
      to: `/app/persona/p1/font-voice?return=${enc}`,
    });
  });

  it('no-voice without a persona offers no link', () => {
    expect(voiceRepairFor('no-voice', null, ret)).toBeNull();
  });

  it('voices-unavailable → Voice settings', () => {
    expect(voiceRepairFor('voices-unavailable', 'p1', ret)).toEqual({
      label: 'Voice settings',
      to: `/app/settings/voice?return=${enc}`,
    });
  });
});

describe('voice copy', () => {
  it('speaks of a voice provider, never a TTS provider', () => {
    for (const text of [...Object.values(VOICE_NOTE), ...Object.values(LIVE_VOICE_TOOLTIP)]) {
      expect(text).not.toMatch(/TTS/);
    }
  });

  it('routes the Live voice tooltip by reason', () => {
    expect(LIVE_VOICE_TOOLTIP['no-provider']).toMatch(/no voice provider/i);
    expect(LIVE_VOICE_TOOLTIP['no-voice']).toMatch(/font & voice/i);
  });
});
