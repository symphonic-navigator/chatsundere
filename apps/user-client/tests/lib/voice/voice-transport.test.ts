// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({
    baseUrl: 'https://api.elevenlabs.io',
    corsHint: 'open',
    auth: { header: 'xi-api-key' },
  }),
}));
vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: { getState: () => ({ mk: new Uint8Array(32) }) },
}));
vi.mock('../../../src/lib/secrets.js', () => ({ openSecret: async () => 'secret-key' }));
vi.mock('../../../src/data/providers.js', () => ({ providerApiKeySlot: () => 'slot' }));

import { resolveVoiceTransportMaterial } from '../../../src/lib/voice/voice-transport.js';

beforeEach(() => vi.clearAllMocks());

describe('resolveVoiceTransportMaterial', () => {
  it("carries the provider definition's auth into providerConfig", async () => {
    const material = await resolveVoiceTransportMaterial(
      { offering: { providerId: 'elevenlabs' } } as never,
      [{ templateId: 'elevenlabs', enabled: true, apiKey: {} }] as never,
      'test',
    );
    expect(material?.providerConfig.auth).toEqual({ header: 'xi-api-key' });
    expect(material?.apiKey).toBe('secret-key');
  });
});
