// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTtsTransportMock = vi.fn();
const listTtsVoicesMock = vi.fn();

vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTtsTransport: () => resolveTtsTransportMock(),
}));

vi.mock('@chatsundere/llm-unified', () => ({
  listTtsVoices: (...args: unknown[]) => listTtsVoicesMock(...args),
}));

import { _resetVoiceListForTests, loadVoiceList } from '../../../src/lib/voice/voice-list.js';

function transport(upstreamSlug: string) {
  return {
    providerConfig: { baseUrl: 'https://api.elevenlabs.io', routing: { kind: 'direct' } },
    apiKey: 'k',
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
