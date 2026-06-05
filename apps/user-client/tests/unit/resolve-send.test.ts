// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAttachmentParts } from '../../src/attachments/resolve-send.js';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';

function img(over: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'a',
    chatId: 'c',
    messageId: 'm',
    origin: 'upload',
    kind: 'image',
    fileName: 'a.png',
    mime: 'image/jpeg',
    order: 0,
    state: 'active',
    createdAt: 0,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 1,
    height: 1,
    visionDescription: null,
    ...over,
  };
}

const deps = {
  toDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx'),
  describe: vi.fn().mockResolvedValue('a cat'),
  cacheDescription: vi.fn().mockResolvedValue(undefined),
};

describe('resolveAttachmentParts', () => {
  beforeEach(() => {
    deps.toDataUrl.mockClear().mockResolvedValue('data:image/jpeg;base64,xxx');
    deps.describe.mockClear().mockResolvedValue('a cat');
    deps.cacheDescription.mockClear().mockResolvedValue(undefined);
  });

  it('image-direct when disposition is direct', async () => {
    const parts = await resolveAttachmentParts([img()], 'direct', 'sub', deps);
    expect(parts[0]).toEqual({
      kind: 'image-direct',
      fileName: 'a.png',
      dataUrl: 'data:image/jpeg;base64,xxx',
    });
  });

  it('image-description (describes + caches) when substitute, cache miss', async () => {
    const parts = await resolveAttachmentParts([img()], 'substitute', 'sub', deps);
    expect(deps.describe).toHaveBeenCalled();
    expect(deps.cacheDescription).toHaveBeenCalledWith('a', 'sub', 'a cat');
    expect(parts[0]).toEqual({
      kind: 'image-description',
      fileName: 'a.png',
      model: 'sub',
      description: 'a cat',
    });
  });

  it('uses the cached description on a cache hit (no describe call)', async () => {
    const parts = await resolveAttachmentParts(
      [img({ visionDescription: { model: 'sub', text: 'cached' } })],
      'substitute',
      'sub',
      deps,
    );
    expect(deps.describe).not.toHaveBeenCalled();
    expect(parts[0]).toEqual({
      kind: 'image-description',
      fileName: 'a.png',
      model: 'sub',
      description: 'cached',
    });
  });

  it('image-placeholder when neither model sees', async () => {
    const parts = await resolveAttachmentParts([img()], 'placeholder', null, deps);
    expect(parts[0]).toEqual({ kind: 'image-placeholder', fileName: 'a.png' });
  });

  it('text attachments become text parts', async () => {
    const parts = await resolveAttachmentParts(
      [img({ kind: 'text', fileName: 'n.md', text: '# x', blob: undefined })],
      'direct',
      null,
      deps,
    );
    expect(parts[0]).toEqual({ kind: 'text', fileName: 'n.md', text: '# x' });
  });

  it('deleted attachments are skipped (parts.length === 0)', async () => {
    const parts = await resolveAttachmentParts([img({ state: 'deleted' })], 'direct', 'sub', deps);
    expect(parts.length).toBe(0);
  });

  it('falls back to image-placeholder for a failing describe, leaving other parts intact', async () => {
    deps.describe.mockRejectedValueOnce(new Error('substitute model unavailable'));
    const textAttachment = img({
      kind: 'text',
      fileName: 'note.md',
      text: 'hello',
      blob: undefined,
    });
    const imageAttachment = img({ id: 'b', fileName: 'photo.jpg' });
    // Place the image first so the error occurs mid-loop with a text part still to process.
    const parts = await resolveAttachmentParts(
      [imageAttachment, textAttachment],
      'substitute',
      'sub',
      deps,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ kind: 'image-placeholder', fileName: 'photo.jpg' });
    expect(parts[1]).toEqual({ kind: 'text', fileName: 'note.md', text: 'hello' });
    // cacheDescription must not have been called for the failed image.
    expect(deps.cacheDescription).not.toHaveBeenCalled();
  });
});
