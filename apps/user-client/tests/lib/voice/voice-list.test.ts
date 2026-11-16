// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTtsTransportMock = vi.fn();
const listTtsVoicesMock = vi.fn();

vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTtsTransport: () => resolveTtsTransportMock(),
}));

vi.mock('@chatsundere/llm-unified', () => ({
  listTtsVoices: (...args: unknown[]) => listTtsVoicesMock(...args),
  getProvider: () => undefined,
}));

import { loadVoiceList } from '../../../src/lib/voice/voice-list-active.js';
import { _resetVoiceListForTests, voiceListKey } from '../../../src/lib/voice/voice-list.js';

function transport(upstreamSlug: string, apiKey = 'k') {
  return {
    providerConfig: { baseUrl: 'https://api.elevenlabs.io', routing: { kind: 'direct' } },
    apiKey,
    offering: { providerId: 'elevenlabs', upstreamSlug },
    ttsMeta: { voices: { kind: 'fetch', endpoint: 'elevenlabs-v2' } },
  };
}

const LIST = { voices: [{ id: 'a', name: 'Adele' }], hiddenCount: 0 };

beforeEach(() => {
  _resetVoiceListForTests();
  listTtsVoicesMock.mockResolvedValue(LIST);
});

afterEach(() => {
  vi.clearAllMocks();
  _resetVoiceListForTests();
});

describe('loadVoiceList', () => {
  it('v4 and v4 Turbo share one fetch', async () => {
    resolveTtsTransportMock.mockResolvedValueOnce(transport('eleven_v4'));
    resolveTtsTransportMock.mockResolvedValueOnce(transport('eleven_v4_turbo'));
    const first = await loadVoiceList();
    const second = await loadVoiceList();
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(1);
    expect(first?.key).toBe(second?.key);
    expect(second?.list).toEqual(LIST);
    expect(first?.accountSource).toBe(true);
  });

  it('a different API key fetches its own list; the same key shares', async () => {
    resolveTtsTransportMock.mockResolvedValueOnce(transport('eleven_v4', 'key-one'));
    resolveTtsTransportMock.mockResolvedValueOnce(transport('eleven_v4', 'key-two'));
    resolveTtsTransportMock.mockResolvedValueOnce(transport('eleven_v4_turbo', 'key-two'));
    const one = await loadVoiceList();
    const two = await loadVoiceList();
    const twoAgain = await loadVoiceList();
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(2);
    expect(one?.key).not.toBe(two?.key);
    expect(two?.key).toBe(twoAgain?.key);
    // The memo key carries a fingerprint, never the key itself.
    expect(one?.key).not.toContain('key-one');
    expect(two?.key).not.toContain('key-two');
  });

  it('fresh refetches', async () => {
    resolveTtsTransportMock.mockResolvedValue(transport('eleven_v4'));
    await loadVoiceList();
    await loadVoiceList({ fresh: true });
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(2);
  });

  it('a failed fetch is evicted and the next call retries', async () => {
    resolveTtsTransportMock.mockResolvedValue(transport('eleven_v4'));
    listTtsVoicesMock.mockRejectedValueOnce(new Error('boom'));
    await expect(loadVoiceList()).rejects.toThrow('boom');
    await Promise.resolve();
    await expect(loadVoiceList()).resolves.toMatchObject({ list: LIST });
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(2);
  });

  it('static sources need no fetch', async () => {
    resolveTtsTransportMock.mockResolvedValue({
      ...transport('tts-1'),
      offering: { providerId: 'nano-gpt', upstreamSlug: 'tts-1' },
      ttsMeta: { voices: { kind: 'static', list: [{ id: 's', name: 'Static' }] } },
    });
    const res = await loadVoiceList();
    expect(listTtsVoicesMock).not.toHaveBeenCalled();
    expect(res?.key).toBe('nano-gpt:static:tts-1');
    expect(res?.list).toEqual({ voices: [{ id: 's', name: 'Static' }], hiddenCount: 0 });
  });

  it('resolves null without a transport', async () => {
    resolveTtsTransportMock.mockResolvedValue(null);
    expect(await loadVoiceList()).toBeNull();
  });
});

describe('loadVoiceList stale rejection', () => {
  it('does not evict a newer in-flight promise', async () => {
    resolveTtsTransportMock.mockResolvedValue(transport('eleven_v4'));
    let rejectFirst!: (e: unknown) => void;
    listTtsVoicesMock.mockReturnValueOnce(
      new Promise((_res, rej) => {
        rejectFirst = rej;
      }),
    );
    let resolveSecond!: (v: unknown) => void;
    listTtsVoicesMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveSecond = res;
      }),
    );
    const p1 = loadVoiceList();
    await vi.waitFor(() => expect(listTtsVoicesMock).toHaveBeenCalledTimes(1));
    const p2 = loadVoiceList({ fresh: true });
    await vi.waitFor(() => expect(listTtsVoicesMock).toHaveBeenCalledTimes(2));

    rejectFirst(new Error('stale'));
    await expect(p1).rejects.toThrow('stale');
    await Promise.resolve();

    const p3 = loadVoiceList();
    await vi.waitFor(() => expect(resolveTtsTransportMock).toHaveBeenCalledTimes(3));
    resolveSecond(LIST);
    await expect(p2).resolves.toMatchObject({ list: LIST });
    await expect(p3).resolves.toMatchObject({ list: LIST });
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(2);
  });
});

function nanoTransport(upstreamSlug: string, apiKey = 'k') {
  return {
    providerConfig: { baseUrl: 'https://nano-gpt.com', routing: { kind: 'direct' } },
    apiKey,
    offering: { providerId: 'nano-gpt', upstreamSlug },
    ttsMeta: { voices: { kind: 'fetch', endpoint: 'nano-gpt-audio-models' } },
  };
}

describe('nano-gpt-audio-models voice source', () => {
  it('keys per upstream slug, so v4 and Turbo differ', () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial transport fixture
    const key = (s: string) => voiceListKey(nanoTransport(s) as any);
    expect(key('elevenlabs/eleven-v4')).not.toBe(key('elevenlabs/eleven-v4-turbo'));
    expect(key('elevenlabs/eleven-v4')).toBe(key('elevenlabs/eleven-v4'));
  });

  it('leaves other fetched sources keyed without the slug', () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial transport fixture
    const key = (s: string) => voiceListKey(transport(s) as any);
    expect(key('eleven_v4')).toBe(key('eleven_v4_turbo'));
  });

  it('passes the upstream slug to listTtsVoices', async () => {
    resolveTtsTransportMock.mockResolvedValueOnce(nanoTransport('elevenlabs/eleven-v4-turbo'));
    await loadVoiceList();
    expect(listTtsVoicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'nano-gpt-audio-models',
        upstreamSlug: 'elevenlabs/eleven-v4-turbo',
      }),
    );
  });
});
