// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extensionForMimeType,
  pickRecordingMimeType,
} from '../../../../src/lib/voice/dictation/audio-recording.js';

describe('pickRecordingMimeType', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when MediaRecorder is unavailable', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickRecordingMimeType()).toBeNull();
  });

  it('prefers webm/opus when supported', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => m.startsWith('audio/webm'),
    });
    expect(pickRecordingMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls back to mp4 when webm is unsupported', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => m.startsWith('audio/mp4'),
    });
    expect(pickRecordingMimeType()).toBe('audio/mp4');
  });
});

describe('extensionForMimeType', () => {
  it('maps the three tiers', () => {
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMimeType('audio/mp4')).toBe('m4a');
    expect(extensionForMimeType('audio/wav')).toBe('wav');
  });
});
