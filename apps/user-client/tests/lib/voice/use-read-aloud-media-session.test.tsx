// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../../src/boot/client-data-db.js';
import type { TransportState } from '../../../src/lib/voice/voice-machine.js';

let bridgeOn = true;
vi.mock('../../../src/lib/voice/audio-sink.js', () => ({
  isReadAloudBridgeEnabled: () => bridgeOn,
}));
vi.mock('../../../src/data/persona-avatars.js', () => ({
  usePersonaAvatar: () => ({ data: null }),
}));

import {
  clearReadAloudSession,
  readAloudMetadata,
  setReadAloudHandlers,
} from '../../../src/lib/voice/media-session.js';
import { useReadAloudMediaSession } from '../../../src/lib/voice/use-read-aloud-media-session.js';
import type { VoicePlayback } from '../../../src/lib/voice/use-voice-playback.js';

class FakeMetadata {
  title: string;
  artist: string;
  artwork: unknown[];
  constructor(init: { title: string; artist?: string; artwork: unknown[] }) {
    this.title = init.title;
    this.artist = init.artist ?? '';
    this.artwork = init.artwork;
  }
}

interface FakeSession {
  metadata: FakeMetadata | null;
  playbackState: string;
  handlers: Map<string, (() => void) | null>;
  setActionHandler: (action: string, handler: (() => void) | null) => void;
}

let fake: FakeSession;

function install(session: FakeSession | null): void {
  if (session) {
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  } else {
    Reflect.deleteProperty(navigator, 'mediaSession');
  }
}

beforeEach(() => {
  bridgeOn = true;
  fake = {
    metadata: null,
    playbackState: 'none',
    handlers: new Map(),
    setActionHandler(action, handler) {
      this.handlers.set(action, handler);
    },
  };
  install(fake);
  vi.stubGlobal('MediaMetadata', FakeMetadata);
});

afterEach(() => {
  install(null);
  vi.unstubAllGlobals();
});

const persona = { id: 'p1', name: 'Mika', adultPersona: false } as unknown as PersonaRow;
const adult = { id: 'p2', name: 'Velvet', adultPersona: true } as unknown as PersonaRow;

function voiceIn(state: TransportState) {
  return {
    transportState: state,
    resumeAudio: vi.fn(),
    pause: vi.fn(),
    skip: vi.fn(),
    stop: vi.fn(),
  } as unknown as VoicePlayback & {
    resumeAudio: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
}

describe('useReadAloudMediaSession', () => {
  it('registers the four handlers and hides previous and seek while reading', () => {
    const voice = voiceIn('speaking');
    renderHook(() => useReadAloudMediaSession(voice, persona, false));
    fake.handlers.get('play')?.();
    fake.handlers.get('pause')?.();
    fake.handlers.get('nexttrack')?.();
    fake.handlers.get('stop')?.();
    expect(voice.resumeAudio).toHaveBeenCalledTimes(1);
    expect(voice.pause).toHaveBeenCalledTimes(1);
    expect(voice.skip).toHaveBeenCalledTimes(1);
    expect(voice.stop).toHaveBeenCalledTimes(1);
    for (const hidden of ['previoustrack', 'seekforward', 'seekbackward', 'seekto']) {
      expect(fake.handlers.has(hidden)).toBe(true);
      expect(fake.handlers.get(hidden)).toBeNull();
    }
  });

  it('shows the persona name and the app icon without an avatar', () => {
    renderHook(() => useReadAloudMediaSession(voiceIn('speaking'), persona, false));
    expect(fake.metadata?.title).toBe('Mika');
    expect(fake.metadata?.artist).toBe('Chatsundere');
    expect(fake.metadata?.artwork).toEqual([
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ]);
  });

  it('shows only the app for an adult persona', () => {
    renderHook(() => useReadAloudMediaSession(voiceIn('speaking'), adult, false));
    expect(fake.metadata?.title).toBe('Chatsundere');
    expect(fake.metadata?.artist).toBe('');
    expect(JSON.stringify(fake.metadata)).not.toContain('Velvet');
  });

  it('mirrors the play state and clears everything at idle', () => {
    const { rerender } = renderHook(
      ({ state }) => useReadAloudMediaSession(voiceIn(state), persona, false),
      { initialProps: { state: 'speaking' as TransportState } },
    );
    expect(fake.playbackState).toBe('playing');
    rerender({ state: 'paused' });
    expect(fake.playbackState).toBe('paused');
    rerender({ state: 'waiting' });
    expect(fake.playbackState).toBe('playing');
    rerender({ state: 'idle' });
    expect(fake.metadata).toBeNull();
    expect(fake.playbackState).toBe('none');
    expect([...fake.handlers.values()].every((h) => h === null)).toBe(true);
  });

  it('clears everything on unmount', () => {
    const { unmount } = renderHook(() =>
      useReadAloudMediaSession(voiceIn('speaking'), persona, false),
    );
    unmount();
    expect(fake.metadata).toBeNull();
    expect(fake.playbackState).toBe('none');
    expect([...fake.handlers.values()].every((h) => h === null)).toBe(true);
  });

  it('registers nothing in live voice', () => {
    renderHook(() => useReadAloudMediaSession(voiceIn('speaking'), persona, true));
    expect(fake.handlers.size).toBe(0);
    expect(fake.metadata).toBeNull();
  });

  it('registers nothing with the bridge off', () => {
    bridgeOn = false;
    renderHook(() => useReadAloudMediaSession(voiceIn('speaking'), persona, false));
    expect(fake.handlers.size).toBe(0);
    expect(fake.metadata).toBeNull();
  });

  it('swallows a throwing setActionHandler and still registers the rest', () => {
    fake.setActionHandler = function (action, handler) {
      if (action === 'seekto') throw new TypeError('unknown action');
      this.handlers.set(action, handler);
    };
    expect(() =>
      renderHook(() => useReadAloudMediaSession(voiceIn('speaking'), persona, false)),
    ).not.toThrow();
    expect(typeof fake.handlers.get('pause')).toBe('function');
  });

  it('does nothing and throws nothing without the API', () => {
    install(null);
    vi.unstubAllGlobals();
    expect('mediaSession' in navigator).toBe(false);
    const { rerender, unmount } = renderHook(
      ({ state }) => useReadAloudMediaSession(voiceIn(state), persona, false),
      { initialProps: { state: 'speaking' as TransportState } },
    );
    rerender({ state: 'idle' });
    unmount();
    expect(() => {
      setReadAloudHandlers({
        play: () => {},
        pause: () => {},
        nexttrack: () => {},
        stop: () => {},
      });
      clearReadAloudSession();
    }).not.toThrow();
  });
});

describe('readAloudMetadata', () => {
  it('uses the rendered avatar for a non-adult persona', () => {
    expect(readAloudMetadata({ name: 'Mika', adultPersona: false }, 'blob:x').artwork).toEqual({
      src: 'blob:x',
      sizes: '256x256',
      type: 'image/png',
    });
  });

  it('never uses the avatar for an adult persona', () => {
    const meta = readAloudMetadata({ name: 'Velvet', adultPersona: true }, 'blob:x');
    expect(meta.artwork.src).toBe('/icons/icon-512.png');
    expect(meta.artist).toBeUndefined();
  });
});
