// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
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
    tonalityEnabled: false,
    globalInstructions: '',
    location: null,
    webSearch: null,
    webFetch: null,
    useProxy: false,
    webSearchTierId: null,
    artefactExpert: null,
    chatId: 'c1',
    personaId: 'p1',
    personaOffering: { providerId: 'nano-gpt', upstreamSlug: 'glm-5.1' },
    getKey: async () => 'api-key',
    ...over,
  };
}

test('execute authors a file, persists it, returns the id via meta + progress', async () => {
  const onProgress = vi.fn();
  const author = vi.fn(async (a: { onProgress?: (n: number) => void; format?: string }) => {
    expect(a.format).toBe('html');
    a.onProgress?.(42);
    return '<!doctype html><title>x</title>';
  });
  const tool = makeArtefactTool(ctx(), {
    // inject the author + the provider/offering resolver so no network/registry is touched
    author,
    resolveBase: () => ({
      base: {
        provider: {} as never,
        providerConfig: {} as never,
        apiKey: 'k',
        target: { slug: 'glm-5.1' } as never,
      },
      reasoning: { enabled: false },
    }),
  });
  const r = await tool.execute({ title: 'Calc', brief: 'a calculator' }, undefined, onProgress);
  expect(r.ok).toBe(true);
  expect(r.meta?.title).toBe('Calc');
  expect(r.meta?.format).toBe('html');
  expect(typeof r.meta?.artefactId).toBe('string');
  expect(r.output).not.toContain('<!doctype'); // never the file body
  expect(onProgress).toHaveBeenCalledWith({ charCount: 42 });
  const rows = await listChatArtefacts('c1');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.content).toContain('<!doctype');
  expect(rows[0]?.format).toBe('html');
  expect(rows[0]?.mime).toBe('text/html');
  expect(rows[0]?.fileName).toMatch(/\.html$/);
});

test('format markdown authors markdown, persists .md / text/markdown, meta.format', async () => {
  const author = vi.fn(async (a: { format?: string; contentAxisPrompt?: string }) => {
    expect(a.format).toBe('markdown');
    return '# Hello\n\nBody.';
  });
  const tool = makeArtefactTool(ctx(), {
    author,
    resolveBase: () => ({
      base: {
        provider: {} as never,
        providerConfig: {} as never,
        apiKey: 'k',
        target: { slug: 'glm-5.1' } as never,
      },
      reasoning: { enabled: false },
    }),
  });
  const r = await tool.execute({
    title: 'Notes',
    brief: 'a note',
    format: 'markdown',
  });
  expect(r.ok).toBe(true);
  expect(r.meta?.format).toBe('markdown');
  const rows = await listChatArtefacts('c1');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.format).toBe('markdown');
  expect(rows[0]?.mime).toBe('text/markdown');
  expect(rows[0]?.fileName).toMatch(/\.md$/);
  expect(rows[0]?.content).toContain('# Hello');
});

test('invalid format returns constructive tool error and persists nothing', async () => {
  const author = vi.fn(async () => '<x>');
  const tool = makeArtefactTool(ctx(), {
    author,
    resolveBase: () => ({
      base: {
        provider: {} as never,
        providerConfig: {} as never,
        apiKey: 'k',
        target: { slug: 'glm-5.1' } as never,
      },
      reasoning: { enabled: false },
    }),
  });
  const r = await tool.execute({ title: 'X', brief: 'y', format: 'pdf' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/html|markdown/i);
  expect(author).not.toHaveBeenCalled();
  expect(await listChatArtefacts('c1')).toHaveLength(0);
});

test('passes content-axis unlockers from context into the author', async () => {
  const author = vi.fn(async () => '<!doctype html><title>x</title>');
  const tool = makeArtefactTool(
    ctx({ nsfwAllowed: true, tonalityEnabled: false, globalInstructions: 'BE BOLD' }),
    {
      author,
      resolveBase: () => ({
        base: {
          provider: {} as never,
          providerConfig: {} as never,
          apiKey: 'k',
          target: { slug: 'glm-5.1' } as never,
        },
        reasoning: { enabled: false },
      }),
    },
  );
  await tool.execute({ title: 'T', brief: 'B' });
  expect(author).toHaveBeenCalled();
  const arg = author.mock.calls[0]?.[0] as { contentAxisPrompt: string };
  expect(arg.contentAxisPrompt).toContain('uncensored');
  expect(arg.contentAxisPrompt).toContain('BE BOLD');
  expect(arg.contentAxisPrompt).not.toMatch(/Encourage creativity/); // tonality off
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
        target: {} as never,
      },
      reasoning: { enabled: false },
    }),
  });
  const r = await tool.execute({ title: 'A', brief: 'b' });
  expect(r.ok).toBe(false);
  expect(await listChatArtefacts('c1')).toHaveLength(0);
});

function baseCtx(over: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
    nsfwAllowed: false,
    tonalityEnabled: false,
    globalInstructions: '',
    location: null,
    webSearch: null,
    webFetch: null,
    useProxy: false,
    webSearchTierId: null,
    getKey: vi.fn(async () => 'k'),
    chatId: 'c1',
    personaId: 'per1',
    personaOffering: { providerId: 'persona-prov', upstreamSlug: 'persona-model' },
    artefactExpert: null,
    ...over,
  };
}

const stubResolve = () =>
  ({
    base: {
      provider: { id: 'x', baseUrl: 'https://x' },
      providerConfig: { baseUrl: 'https://x', routing: { kind: 'direct' } },
      apiKey: '',
      target: {},
    },
    reasoning: { enabled: false },
  }) as never;

describe('create_artefact — expert selection', () => {
  it('fetches the key for the expert provider when an expert is set', async () => {
    const getKey = vi.fn(async () => 'expert-key');
    const author = vi.fn(async () => '<html></html>');
    const ctx = baseCtx({
      getKey,
      artefactExpert: { providerId: 'anthropic', upstreamSlug: 'opus-4-8' },
    });
    const tool = makeArtefactTool(ctx, { author, resolveBase: stubResolve });
    // execute()'s own try/catch always resolves a ToolResult (never rejects),
    // so no .catch is needed here — the write reliably succeeds against the
    // fake-indexeddb DB opened in beforeEach.
    await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined);
    expect(getKey).toHaveBeenCalledWith('anthropic');
    expect(author).toHaveBeenCalled();
  });

  it('fetches the persona key when no expert is set', async () => {
    const getKey = vi.fn(async () => 'persona-key');
    const author = vi.fn(async () => '<html></html>');
    const ctx = baseCtx({ getKey, artefactExpert: null });
    const tool = makeArtefactTool(ctx, { author, resolveBase: stubResolve });
    await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined);
    expect(getKey).toHaveBeenCalledWith('persona-prov');
  });

  it('returns the discriminant error (no fallback) when the expert key is missing', async () => {
    const ctx = baseCtx({
      getKey: vi.fn(async () => null),
      artefactExpert: { providerId: 'anthropic', upstreamSlug: 'opus-4-8' },
    });
    const author = vi.fn(async () => '<html></html>');
    const tool = makeArtefactTool(ctx, { author, resolveBase: stubResolve });
    const r = await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined);
    expect(r.ok).toBe(false);
    expect(r.meta?.artefactExpertUnavailable).toBe(true);
    expect(author).not.toHaveBeenCalled();
  });

  it('gives a plain error (no discriminant) when the persona key is missing', async () => {
    const ctx = baseCtx({ getKey: vi.fn(async () => null), artefactExpert: null });
    const tool = makeArtefactTool(ctx, { resolveBase: stubResolve });
    const r = await tool.execute({ title: 'T', brief: 'B' }, undefined, undefined);
    expect(r.ok).toBe(false);
    expect(r.meta?.artefactExpertUnavailable).toBeUndefined();
  });
});
