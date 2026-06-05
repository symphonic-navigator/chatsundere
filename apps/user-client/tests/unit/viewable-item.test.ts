// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { attachmentToViewable } from '../../src/components/lightbox/viewable-item.js';

function row(over: Partial<AttachmentRow>): AttachmentRow {
  return {
    id: 'a',
    chatId: 'c',
    messageId: null,
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

describe('attachmentToViewable', () => {
  it('pending upload image → image kind, rename+remove, no download/delete, no editSource', () => {
    const v = attachmentToViewable(row({}), { pending: true, objectUrl: 'blob:1' });
    expect(v.kind).toBe('image');
    expect(v.imageUrl).toBe('blob:1');
    expect(v.caps).toEqual({
      rename: true,
      remove: true,
      download: false,
      delete: false,
      editSource: false,
    });
  });

  it('pending markdown text → markdown kind, editable source', () => {
    const v = attachmentToViewable(
      row({ kind: 'text', fileName: 'n.md', mime: 'text/markdown', text: '# x', blob: undefined }),
      { pending: true },
    );
    expect(v.kind).toBe('markdown');
    expect(v.text).toBe('# x');
    expect(v.caps.editSource).toBe(true);
    expect(v.caps.remove).toBe(true);
  });

  it('plain text (.txt) → text kind, not markdown', () => {
    const v = attachmentToViewable(
      row({ kind: 'text', fileName: 'log.txt', mime: 'text/plain', text: 'hi', blob: undefined }),
      { pending: true },
    );
    expect(v.kind).toBe('text');
  });

  it('sent upload → rename only, no remove, source read-only', () => {
    const v = attachmentToViewable(
      row({ messageId: 'm', kind: 'text', fileName: 'n.md', text: 'x', blob: undefined }),
      { pending: false },
    );
    expect(v.caps).toEqual({
      rename: true,
      remove: false,
      download: false,
      delete: false,
      editSource: false,
    });
  });
});
