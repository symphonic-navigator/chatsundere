// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { attachmentToViewable } from '../../src/components/lightbox/viewable-item.js';

function makeRow(over: Partial<AttachmentRow>): AttachmentRow {
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
    updatedAt: 0,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 1,
    height: 1,
    visionDescription: null,
    ...over,
  };
}

describe('attachmentToViewable', () => {
  it('pending upload image → image kind, rename+remove, no copy/download/delete, no editSource', () => {
    const v = attachmentToViewable(makeRow({}), { pending: true, objectUrl: 'blob:1' });
    expect(v.kind).toBe('image');
    expect(v.imageUrl).toBe('blob:1');
    expect(v.caps).toEqual({
      rename: true,
      remove: true,
      copy: false,
      download: false,
      delete: false,
      editSource: false,
      editTags: false,
    });
  });

  it('maps a text row to kind "text" carrying mime, with copy/download caps', () => {
    const row = makeRow({
      kind: 'text',
      fileName: 'notes.md',
      mime: 'text/markdown',
      text: '# Hi',
    });
    const v = attachmentToViewable(row, { pending: true });
    expect(v.kind).toBe('text');
    expect(v.mime).toBe('text/markdown');
    expect(v.caps.copy).toBe(true);
    expect(v.caps.download).toBe(true);
    expect(v.caps.editSource).toBe(true);
  });

  it('maps an image row with copy/download disabled', () => {
    const row = makeRow({ kind: 'image', fileName: 'p.jpg', mime: 'image/jpeg' });
    const v = attachmentToViewable(row, { pending: false, objectUrl: 'blob:x' });
    expect(v.kind).toBe('image');
    expect(v.caps.copy).toBe(false);
    expect(v.caps.download).toBe(false);
  });

  it('pending text (.md) → text kind, editable source, carries text content', () => {
    const v = attachmentToViewable(
      makeRow({
        kind: 'text',
        fileName: 'n.md',
        mime: 'text/markdown',
        text: '# x',
        blob: undefined,
      }),
      { pending: true },
    );
    expect(v.kind).toBe('text');
    expect(v.text).toBe('# x');
    expect(v.caps.editSource).toBe(true);
    expect(v.caps.remove).toBe(true);
  });

  it('plain text (.txt) → text kind with copy/download caps', () => {
    const v = attachmentToViewable(
      makeRow({
        kind: 'text',
        fileName: 'log.txt',
        mime: 'text/plain',
        text: 'hi',
        blob: undefined,
      }),
      { pending: true },
    );
    expect(v.kind).toBe('text');
    expect(v.caps.copy).toBe(true);
    expect(v.caps.download).toBe(true);
  });

  it('sent upload → rename only, no remove, source read-only', () => {
    const v = attachmentToViewable(
      makeRow({
        messageId: 'm',
        kind: 'text',
        fileName: 'n.md',
        mime: 'text/markdown',
        text: 'x',
        blob: undefined,
      }),
      { pending: false },
    );
    expect(v.caps).toEqual({
      rename: true,
      remove: false,
      copy: true,
      download: true,
      delete: false,
      editSource: false,
      editTags: false,
    });
  });
});

function libRow(over: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'a1',
    chatId: 'c1',
    messageId: null,
    origin: 'library',
    kind: 'text',
    fileName: 'Doc.md',
    mime: 'text/markdown',
    order: 0,
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
    kbRef: { libraryId: 'lib1', documentId: 'doc1' },
    ...over,
  };
}

describe('attachmentToViewable — library origin', () => {
  it('uses effectiveText when the row has no copied text yet, and is removable while pending', () => {
    const v = attachmentToViewable(libRow(), {
      pending: true,
      effectiveText: 'live body',
      provenance: 'My Library › Doc',
    });
    expect(v.text).toBe('live body');
    expect(v.caps.remove).toBe(true);
    expect(v.caps.editSource).toBe(true);
    expect(v.provenance).toBe('My Library › Doc');
  });

  it('prefers the row text once materialised', () => {
    const v = attachmentToViewable(libRow({ text: 'edited' }), {
      pending: true,
      effectiveText: 'live body',
    });
    expect(v.text).toBe('edited');
  });

  it('does not offer editSource for a library reference whose live content has not loaded yet', () => {
    const v = attachmentToViewable(libRow(), { pending: true }); // no effectiveText, no row.text
    expect(v.caps.editSource).toBe(false);
  });

  it('offers editSource once the live content has loaded', () => {
    const v = attachmentToViewable(libRow(), { pending: true, effectiveText: 'live body' });
    expect(v.caps.editSource).toBe(true);
  });
});
