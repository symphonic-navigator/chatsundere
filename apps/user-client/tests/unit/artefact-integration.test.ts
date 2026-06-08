// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { listChatArtefacts } from '../../src/data/artefacts.js';
import { QK } from '../../src/data/queryKeys.js';
import { makeArtefactTool } from '../../src/integrations/artefact/artefact-integration.js';
import type { IntegrationContext } from '../../src/integrations/types.js';
import { queryClient } from '../../src/lib/queryClient.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

function ctx(over: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
    nsfwAllowed: false,
    location: null,
    webSearch: null,
    webFetch: null,
    corsProxyUrl: null,
    corsProxyKey: null,
    webSearchTierId: null,
    chatId: 'c1',
    personaId: 'p1',
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => 'api-key',
    ...over,
  };
}

test('execute authors a file, persists it, returns the id via meta + progress', async () => {
  const onProgress = vi.fn();
  const tool = makeArtefactTool(ctx(), {
    // inject the author + the provider/offering resolver so no network/registry is touched
    author: async (a) => {
      a.onProgress?.(42);
      return '<!doctype html><title>x</title>';
    },
    resolveBase: () => ({
      base: {
        provider: {} as never,
        providerConfig: {} as never,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        target: { slug: 'glm-5.1' } as never,
      },
      reasoning: { enabled: false },
    }),
  });
  const r = await tool.execute({ title: 'Calc', brief: 'a calculator' }, undefined, onProgress);
  expect(r.ok).toBe(true);
  expect(r.meta?.title).toBe('Calc');
  expect(typeof r.meta?.artefactId).toBe('string');
  expect(r.output).not.toContain('<!doctype'); // never the file body
  expect(onProgress).toHaveBeenCalledWith({ charCount: 42 });
  const rows = await listChatArtefacts('c1');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toContain('<!doctype');
});

test('invalidates the chat artefacts query so the lightbox sees the new row', async () => {
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  const tool = makeArtefactTool(ctx(), {
    author: async () => '<!doctype html><title>x</title>',
    resolveBase: () => ({
      base: {
        provider: {} as never,
        providerConfig: {} as never,
        apiKey: 'k',
        corsProxyUrl: null,
        corsProxyKey: null,
        target: { slug: 'glm-5.1' } as never,
      },
      reasoning: { enabled: false },
    }),
  });
  await tool.execute({ title: 'Calc', brief: 'a calculator' });
  expect(spy).toHaveBeenCalledWith({ queryKey: QK.chatArtefacts('c1') });
  spy.mockRestore();
});

test('missing key → failed result, nothing persisted', async () => {
  const tool = makeArtefactTool(ctx({ getKey: async () => null }), {
    author: async () => '<x>',
    resolveBase: () => ({
      base: {
        provider: {} as never,
        providerConfig: {} as never,
        apiKey: '',
        corsProxyUrl: null,
        corsProxyKey: null,
        target: {} as never,
      },
      reasoning: { enabled: false },
    }),
  });
  const r = await tool.execute({ title: 'A', brief: 'b' });
  expect(r.ok).toBe(false);
  expect(await listChatArtefacts('c1')).toHaveLength(0);
});
