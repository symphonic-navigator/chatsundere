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
const openSecret = vi.fn(async (..._a: unknown[]) => 'sk-test');
vi.mock('../../src/lib/secrets.js', () => ({ openSecret: (...a: unknown[]) => openSecret(...a) }));
vi.mock('../../src/data/providers.js', () => ({ providerApiKeySlot: () => 'slot' }));
const resolveBackgroundBundle = vi.fn();
vi.mock('../../src/data/resolve-background-offering.js', () => ({
  resolveBackgroundBundle: (...a: unknown[]) => resolveBackgroundBundle(...a),
}));

import { MasterKeyUnavailableError, ProviderKeyLockedError } from '../../src/data/send-errors.js';
import { resolveMemoryConsolidationArgs } from '../../src/memory/resolve-args.js';

afterEach(() => vi.clearAllMocks());

describe('resolveMemoryConsolidationArgs', () => {
  it('throws when the master key is unavailable', async () => {
    getState.mockReturnValue({ mk: null });
    await expect(resolveMemoryConsolidationArgs('p1', 'memory-consolidate')).rejects.toBeInstanceOf(
      MasterKeyUnavailableError,
    );
  });

  it('throws ProviderKeyLockedError (id and name only) when the key cannot be opened', async () => {
    getState.mockReturnValue({ mk: {} });
    personasGet.mockResolvedValue({ id: 'p1', providerId: 'pr1', modelId: 'm1' });
    providersGet.mockResolvedValue({ id: 'pr1', templateId: 'nano-gpt', apiKey: {} });
    getProvider.mockReturnValue({ displayName: 'NanoGPT', baseUrl: 'https://x', corsHint: 'none' });
    getOffering.mockReturnValue({ id: 'm1' });
    openSecret.mockRejectedValueOnce(
      Object.assign(new Error('secret internals'), { name: 'OperationError' }),
    );
    const err = await resolveMemoryConsolidationArgs('p1', 'memory-consolidate').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ProviderKeyLockedError);
    expect(err).toMatchObject({ templateId: 'nano-gpt', providerName: 'NanoGPT' });
    expect((err as Error).message).not.toContain('secret internals');
    expect((err as Error).cause).toBeUndefined();
    expect(resolveBackgroundBundle).not.toHaveBeenCalled();
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
