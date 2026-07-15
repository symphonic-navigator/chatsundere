// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

// Fake catalogue: the helper provider template resolves; anything else does not.
vi.mock('@chatsundere/llm-unified', async (orig) => {
  const actual = await orig<typeof import('@chatsundere/llm-unified')>();
  return {
    ...actual,
    getProvider: vi.fn((templateId: string) =>
      templateId === 'helper-tmpl'
        ? { baseUrl: 'https://helper.example', corsHint: 'direct' }
        : undefined,
    ),
    getOffering: vi.fn((templateId: string, slug: string) =>
      templateId === 'helper-tmpl' && slug === 'helper/model'
        ? { canonicalRef: 'glm-5', upstreamSlug: 'helper/model', providerId: 'helper-tmpl' }
        : undefined,
    ),
  };
});

vi.mock('../../src/data/providers.js', () => ({ providerApiKeySlot: () => 'slot' }));

const openSecretMock = vi.fn(async (..._a: unknown[]) => 'helper-key');
vi.mock('../../src/lib/secrets.js', () => ({
  openSecret: (...a: unknown[]) => openSecretMock(...a),
}));

import {
  type ChoreCallBundle,
  hasBackgroundHelper,
  resolveBackgroundBundle,
} from '../../src/data/resolve-background-offering.js';

// Recognisable "own model" fallback — asserted by identity to prove no swap.
const fallback = {
  provider: { baseUrl: 'https://own.example', corsHint: 'direct' },
  providerConfig: { baseUrl: 'https://own.example', routing: { kind: 'direct' } },
  apiKey: 'own-key',
  offering: { canonicalRef: 'deepseek-v4-pro', upstreamSlug: 'own/model', providerId: 'own-tmpl' },
} as unknown as ChoreCallBundle;

function fakeDb(rows: Record<string, unknown>) {
  return {
    providers: { get: async (id: string) => rows[id] },
  } as never;
}

const helperRow = { id: 'helper-row', templateId: 'helper-tmpl', apiKey: {}, enabled: true };
const mk = {} as never;

const setPersona = {
  backgroundCanonicalId: 'glm-5',
  backgroundProviderId: 'helper-row',
  backgroundModelId: 'helper/model',
};

afterEach(() => {
  openSecretMock.mockReset();
  openSecretMock.mockResolvedValue('helper-key');
});

describe('hasBackgroundHelper', () => {
  it('true only when all three tuple fields are present', () => {
    expect(hasBackgroundHelper(setPersona)).toBe(true);
    expect(hasBackgroundHelper({ backgroundCanonicalId: null })).toBe(false);
    expect(
      hasBackgroundHelper({
        backgroundCanonicalId: 'glm-5',
        backgroundProviderId: 'helper-row',
        backgroundModelId: '',
      }),
    ).toBe(false);
  });
});

describe('resolveBackgroundBundle', () => {
  it('returns the fallback unchanged when no helper is set', async () => {
    const out = await resolveBackgroundBundle({ backgroundCanonicalId: null }, fallback, {
      db: fakeDb({}),
      mk,
    });
    expect(out).toBe(fallback); // identity — the persona's own model
  });

  it('resolves the helper bundle when set and reachable', async () => {
    const out = await resolveBackgroundBundle(setPersona, fallback, {
      db: fakeDb({ 'helper-row': helperRow }),
      mk,
    });
    expect(out).not.toBe(fallback);
    expect(out.provider.baseUrl).toBe('https://helper.example');
    expect(out.providerConfig).toEqual({
      baseUrl: 'https://helper.example',
      routing: { kind: 'direct' },
    });
    expect(out.apiKey).toBe('helper-key');
    expect(out.offering.upstreamSlug).toBe('helper/model');
  });

  it('falls back silently when the helper provider row is gone', async () => {
    const out = await resolveBackgroundBundle(setPersona, fallback, {
      db: fakeDb({}), // row deleted
      mk,
    });
    expect(out).toBe(fallback);
  });

  it('falls back silently when the helper offering no longer exists', async () => {
    const out = await resolveBackgroundBundle(
      { ...setPersona, backgroundModelId: 'vanished/model' },
      fallback,
      { db: fakeDb({ 'helper-row': helperRow }), mk },
    );
    expect(out).toBe(fallback);
  });

  it('falls back silently when the helper api-key will not decrypt', async () => {
    openSecretMock.mockRejectedValueOnce(new Error('bad key'));
    const out = await resolveBackgroundBundle(setPersona, fallback, {
      db: fakeDb({ 'helper-row': helperRow }),
      mk,
    });
    expect(out).toBe(fallback);
  });
});
