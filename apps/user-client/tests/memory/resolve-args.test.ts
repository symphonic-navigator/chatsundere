// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

const personasGet = vi.fn();
const providersGet = vi.fn();
const chatsGet = vi.fn();
vi.mock('../../src/boot/client-data-db.js', () => ({
  getClientDataDb: () => ({
    personas: { get: (...a: unknown[]) => personasGet(...a) },
    providers: { get: (...a: unknown[]) => providersGet(...a) },
    chats: { get: (...a: unknown[]) => chatsGet(...a) },
  }),
}));
const getState = vi.fn();
vi.mock('@chatsundere/ui-shared', () => ({ useSessionStore: { getState: () => getState() } }));
const getProvider = vi.fn();
const getOffering = vi.fn();
vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (...a: unknown[]) => getProvider(...a),
  getOffering: (...a: unknown[]) => getOffering(...a),
}));
vi.mock('../../src/lib/secrets.js', () => ({ openSecret: vi.fn(async () => 'sk-test') }));
vi.mock('../../src/data/providers.js', () => ({ providerApiKeySlot: () => 'slot' }));
const resolveBackgroundBundle = vi.fn();
vi.mock('../../src/data/resolve-background-offering.js', () => ({
  resolveBackgroundBundle: (...a: unknown[]) => resolveBackgroundBundle(...a),
}));

import { resolveMemoryConsolidationArgs } from '../../src/memory/resolve-args.js';

afterEach(() => vi.clearAllMocks());

describe('resolveMemoryConsolidationArgs', () => {
  it('throws when the master key is unavailable', async () => {
    getState.mockReturnValue({ mk: null });
    await expect(resolveMemoryConsolidationArgs('p1', 'memory-consolidate')).rejects.toThrow(
      /master key/,
    );
  });

  it('throws when the persona does not exist', async () => {
    getState.mockReturnValue({ mk: {} });
    personasGet.mockResolvedValue(undefined);
    await expect(resolveMemoryConsolidationArgs('p1', 'memory-consolidate')).rejects.toThrow(
      /persona not found/,
    );
  });

  it('resolves persona + model bundle from a personaId with no chat lookup', async () => {
    getState.mockReturnValue({ mk: {} });
    personasGet.mockResolvedValue({ id: 'p1', providerId: 'pr1', modelId: 'm1' });
    providersGet.mockResolvedValue({ templateId: 'nano-gpt', apiKey: {} });
    getProvider.mockReturnValue({ templateId: 'nano-gpt', baseUrl: 'https://x', corsHint: 'none' });
    getOffering.mockReturnValue({ id: 'm1' });
    resolveBackgroundBundle.mockResolvedValue({
      provider: { templateId: 'nano-gpt' },
      providerConfig: { baseUrl: 'https://x', routing: { kind: 'direct' } },
      apiKey: 'sk-test',
      offering: { id: 'm1' },
    });
    const args = await resolveMemoryConsolidationArgs('p1', 'memory-consolidate');
    expect(args.persona.id).toBe('p1');
    expect('chat' in args).toBe(false);
    expect(chatsGet).not.toHaveBeenCalled();
    expect(args.offering).toEqual({ id: 'm1' });
  });
});
