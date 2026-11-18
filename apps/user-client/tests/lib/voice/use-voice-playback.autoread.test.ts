// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const okResolution = {
  ok: true,
  fetchAudio: async () => new Blob(),
  voiceLabel: 'Test',
  cacheKeyFor: () => 'k',
};
const resolveTtsMock = vi.fn(async (): Promise<unknown> => okResolution);
vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTts: () => resolveTtsMock(),
}));

vi.mock('../../../src/lib/voice/voice-cache.js', () => ({
  cacheDelete: vi.fn(async () => {}),
}));

vi.mock('../../../src/lib/voice/audio-sink.js', () => ({
  isReadAloudBridgeEnabled: () => true,
  AudioSink: class {
    setRoute = vi.fn();
    setReadPhase = vi.fn();
    primeBridge = vi.fn();
    play = vi.fn(async () => {});
    pause = vi.fn(async () => {});
    resume = vi.fn(async () => {});
    stop = vi.fn();
    dispose = vi.fn(async () => {});
  },
}));

let handle: unknown = null;
const streams = () => (handle ? new Map([['c1', handle]]) : new Map());
vi.mock('../../../src/state/stream-manager.store.js', () => ({
  useStreamManagerStore: Object.assign(
    (selector: (s: { streams: Map<string, unknown> }) => unknown) =>
      selector({ streams: streams() }),
    { getState: () => ({ streams: streams() }) },
  ),
}));

let autoReadAloud = false;
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { autoReadAloud, voiceMode: 'paragraph' } }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));

import type { PersonaRow } from '../../../src/boot/client-data-db.js';
import { useVoicePlayback } from '../../../src/lib/voice/use-voice-playback.js';

const persona = {
  id: 'p1',
  roleplay: false,
  voice: 'v1',
  narratorVoice: null,
} as unknown as PersonaRow;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: new QueryClient() }, children);
}

describe('auto-read driver', () => {
  beforeEach(() => {
    handle = null;
    autoReadAloud = false;
    resolveTtsMock.mockReset();
    resolveTtsMock.mockResolvedValue(okResolution);
  });

  it('does not auto-play when mode is off', async () => {
    autoReadAloud = false;
    handle = {
      draftMessageId: 'm1',
      status: 'streaming',
      contentBuffer: [{ type: 'text', text: 'Done.\n\nmore' }],
    };
    const { result } = renderHook(() => useVoicePlayback('c1', persona, []), { wrapper });
    await act(async () => {});
    expect(result.current.transportState).toBe('idle');
  });

  it('does not auto-play with no committed paragraph', async () => {
    autoReadAloud = true;
    handle = {
      draftMessageId: 'm1',
      status: 'streaming',
      contentBuffer: [{ type: 'text', text: 'still typing' }],
    };
    const { result } = renderHook(() => useVoicePlayback('c1', persona, []), { wrapper });
    await act(async () => {});
    expect(result.current.transportState).toBe('idle');
  });

  it('writes a failed resolution back to disabledReason', async () => {
    autoReadAloud = true;
    const { result, rerender } = renderHook(() => useVoicePlayback('c1', persona, []), {
      wrapper,
    });
    await act(async () => {});
    expect(result.current.disabledReason).toBeNull();

    // The mount probe succeeded; the driver's own resolution then fails.
    resolveTtsMock.mockResolvedValue({ ok: false, reason: 'voices-unavailable' });
    handle = {
      draftMessageId: 'm1',
      status: 'streaming',
      contentBuffer: [
        {
          type: 'text',
          text: 'A first paragraph long enough to be committed and read aloud.\n\nmore',
        },
      ],
    };
    rerender();
    await act(async () => {});
    expect(result.current.disabledReason).toBe('voices-unavailable');
    expect(result.current.transportState).toBe('idle');
  });
});
