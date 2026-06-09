// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { addGeneratedImageArtefact, titleFromPrompt } from '../../src/data/artefacts.js';

// JSDOM's structuredClone does not preserve Blob objects — it serialises them
// to plain `{}`. fake-indexeddb calls structuredClone when writing a row, so
// Blob fields stored in IndexedDB come back empty in tests.  Patch the global
// to re-attach any Blob fields after the clone so size assertions work.
{
  const _orig = globalThis.structuredClone;
  // biome-ignore lint/suspicious/noExplicitAny: test-only shim
  (globalThis as any).structuredClone = function blobPreservingClone<T>(
    value: T,
    opts?: StructuredSerializeOptions,
  ): T {
    const cloned = _orig(value, opts);
    if (value && typeof value === 'object' && !(value instanceof Blob)) {
      for (const key of Object.keys(value as object)) {
        // biome-ignore lint/suspicious/noExplicitAny: test-only shim
        if ((value as any)[key] instanceof Blob) (cloned as any)[key] = (value as any)[key];
      }
    }
    return cloned;
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('titleFromPrompt', () => {
  it('takes the first five words', () => {
    expect(titleFromPrompt('a small watercolour fox sitting on a mossy stone')).toBe(
      'a small watercolour fox sitting',
    );
  });
  it('falls back on an empty prompt', () => {
    expect(titleFromPrompt('   ')).toBe('Generated image');
  });
});

describe('addGeneratedImageArtefact', () => {
  it('persists kind image with blobs, dimensions, and genMeta provenance', async () => {
    const bytes = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const thumb = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const id = await addGeneratedImageArtefact({
      chatId: 'c1',
      personaId: 'p1',
      prompt: 'a small watercolour fox sitting on a mossy stone',
      modelRef: 'nano-gpt:z-image-turbo',
      modelLabel: 'Z-Image',
      configSnapshot: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
      bytes,
      mime: 'image/jpeg',
      thumbBlob: thumb,
      width: 1024,
      height: 1024,
    });
    const row = await getClientDataDb().artefacts.get(id);
    expect(row?.kind).toBe('image');
    expect(row?.format).toBe('image');
    expect(row?.origin).toBe('generated');
    expect(row?.mime).toBe('image/jpeg');
    expect(row?.content).toBe('');
    expect(row?.title).toBe('a small watercolour fox sitting');
    expect(row?.fileName).toMatch(/\.jpg$/);
    expect(row?.width).toBe(1024);
    expect(row?.height).toBe(1024);
    expect(row?.blob?.size).toBe(bytes.size);
    expect(row?.thumbBlob?.size).toBe(thumb.size);
    expect(row?.genMeta?.prompt).toContain('watercolour fox');
    expect(row?.genMeta?.modelLabel).toBe('Z-Image');
  });
});
