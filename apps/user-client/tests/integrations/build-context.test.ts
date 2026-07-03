// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationRoute } from '../../src/integrations/build-context.js';
import { buildIntegrationContext } from '../../src/integrations/build-context.js';
import type { OfferingRef } from '../../src/integrations/types.js';

const REF: OfferingRef = { providerId: 'nano-gpt', upstreamSlug: 'brave' };
const fakeMk = {} as MasterKey;
const noRoute: IntegrationRoute = { useProxy: false, webSearchTierId: null };
/** Minimal placeholder used by tests that do not exercise artefact fields. */
const noArtefact = {
  chatId: '',
  personaId: '',
  personaOffering: { providerId: '', upstreamSlug: '' },
};

describe('buildIntegrationContext', () => {
  it('maps persona nsfw flag and web settings into the context', () => {
    const ctx = buildIntegrationContext(
      { adultPersona: true },
      { search: REF, fetch: null },
      fakeMk,
      noRoute,
      noArtefact,
      async () => 'k',
    );
    expect(ctx.nsfwAllowed).toBe(true);
    expect(ctx.location).toBeNull();
    expect(ctx.webSearch).toEqual(REF);
    expect(ctx.webFetch).toBeNull();
  });

  it('maps route fields into the context', () => {
    const route: IntegrationRoute = {
      useProxy: true,
      webSearchTierId: 'advanced',
    };
    const ctx = buildIntegrationContext(
      { adultPersona: false },
      { search: null, fetch: null },
      fakeMk,
      route,
      noArtefact,
    );
    expect(ctx.useProxy).toBe(true);
    expect(ctx.webSearchTierId).toBe('advanced');
  });

  it('propagates null route fields into the context', () => {
    const ctx = buildIntegrationContext(
      { adultPersona: false },
      { search: null, fetch: null },
      fakeMk,
      noRoute,
      noArtefact,
    );
    expect(ctx.useProxy).toBe(false);
    expect(ctx.webSearchTierId).toBeNull();
  });

  it('getKey delegates to the credential retriever with the master key', async () => {
    const getKeyFn = vi.fn(async () => 'secret');
    const ctx = buildIntegrationContext(
      { adultPersona: false },
      { search: null, fetch: null },
      fakeMk,
      noRoute,
      noArtefact,
      getKeyFn,
    );
    await expect(ctx.getKey('nano-gpt')).resolves.toBe('secret');
    expect(getKeyFn).toHaveBeenCalledWith('nano-gpt', fakeMk);
  });

  it('getKey returns null when there is no master key', async () => {
    const getKeyFn = vi.fn(async () => 'secret');
    const ctx = buildIntegrationContext(
      { adultPersona: false },
      { search: null, fetch: null },
      null,
      noRoute,
      noArtefact,
      getKeyFn,
    );
    await expect(ctx.getKey('nano-gpt')).resolves.toBeNull();
    expect(getKeyFn).not.toHaveBeenCalled();
  });
});
