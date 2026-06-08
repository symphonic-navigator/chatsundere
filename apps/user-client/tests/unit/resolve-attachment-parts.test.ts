// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { resolveAttachmentParts } from '../../src/attachments/resolve-send.js';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';

const img = (over: Partial<AttachmentRow> = {}): AttachmentRow =>
  ({
    id: 'a1',
    chatId: 'c1',
    messageId: 'm1',
    kind: 'image',
    origin: 'upload',
    state: 'active',
    fileName: 'cat.jpg',
    mime: 'image/jpeg',
    blob: new Blob(['x']),
    createdAt: 1,
    ...over,
  }) as AttachmentRow;

const deps = {
  toDataUrl: async () => 'data:,',
  describe: async () => 'A cat.',
  cacheDescription: async () => {},
};

describe('resolveAttachmentParts describe callbacks', () => {
  it('fires onDescribeStart/onDescribeEnd once for an uncached substitute image', async () => {
    const start = vi.fn();
    const end = vi.fn();
    await resolveAttachmentParts([img()], 'substitute', 'prov:model', {
      ...deps,
      onDescribeStart: start,
      onDescribeEnd: end,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), {
      ok: true,
      text: 'A cat.',
    });
  });

  it('reports failure through onDescribeEnd and does not throw', async () => {
    const end = vi.fn();
    const parts = await resolveAttachmentParts([img()], 'substitute', 'prov:model', {
      ...deps,
      describe: async () => {
        throw new Error('boom');
      },
      onDescribeStart: vi.fn(),
      onDescribeEnd: end,
    });
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), {
      ok: false,
      error: 'boom',
    });
    expect(parts[0]).toEqual({ kind: 'image-placeholder', fileName: 'cat.jpg' });
  });

  it('does not fire for a cached description', async () => {
    const start = vi.fn();
    await resolveAttachmentParts(
      [img({ visionDescription: { model: 'prov:model', text: 'cached' } })],
      'substitute',
      'prov:model',
      { ...deps, onDescribeStart: start, onDescribeEnd: vi.fn() },
    );
    expect(start).not.toHaveBeenCalled();
  });
});
