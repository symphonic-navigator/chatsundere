// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, vi } from 'vitest';
import type { ArtefactRow } from '../../src/boot/client-data-db.js';
import { artefactToViewable } from '../../src/components/lightbox/viewable-item.js';

const row: ArtefactRow = {
  id: 'a1',
  chatId: 'c1',
  personaId: 'p1',
  projectId: null,
  origin: 'generated',
  kind: 'text',
  format: 'html',
  title: 'Calc',
  fileName: 'calc.html',
  mime: 'text/html',
  content: '<x>',
  tags: [],
  favourite: false,
  createdAt: 0,
  updatedAt: 0,
};

const imageRow: ArtefactRow = {
  id: 'i1',
  chatId: 'c1',
  personaId: 'p1',
  projectId: null,
  origin: 'generated',
  kind: 'image',
  format: 'image',
  title: 'A fox',
  fileName: 'a-fox.jpg',
  mime: 'image/jpeg',
  content: '',
  tags: ['fox'],
  favourite: false,
  createdAt: 0,
  updatedAt: 0,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
  thumbBlob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
  width: 1024,
  height: 1024,
  genMeta: {
    prompt: 'a fox',
    modelRef: 'nano-gpt:z-image-turbo',
    modelLabel: 'Z-Image',
    configSnapshot: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
  },
};

test('maps a text artefact row exactly as before (regression pin)', () => {
  const v = artefactToViewable(row);
  expect(v).toEqual({
    id: 'a1',
    kind: 'text',
    fileName: 'calc.html',
    title: 'Calc',
    mime: 'text/html',
    text: '<x>',
    tags: [],
    caps: {
      rename: true,
      remove: false,
      copy: true,
      download: true,
      delete: true,
      editSource: true,
      editTags: true,
    },
  });
  expect(v.imageUrl).toBeUndefined();
  expect(v.provenance).toBeUndefined();
});

test('maps an image artefact row to an image viewable with provenance', () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:full');
  const v = artefactToViewable(imageRow);
  expect(v.kind).toBe('image');
  expect(v.imageUrl).toBe('blob:full');
  // The full blob is preferred over the thumbnail.
  expect(createUrl).toHaveBeenCalledWith(imageRow.blob);
  expect(v.provenance).toBe('a fox — via Z-Image');
  expect(v.tags).toEqual(['fox']);
  expect(v.caps).toEqual({
    rename: true,
    remove: false,
    copy: false,
    download: true,
    delete: true,
    editSource: false,
    editTags: true,
  });
  createUrl.mockRestore();
});

test('image artefact without genMeta has no provenance and does not crash', () => {
  const { genMeta: _omitted, ...rest } = imageRow;
  const v = artefactToViewable(rest);
  expect(v.kind).toBe('image');
  expect(v.provenance).toBeUndefined();
});

test('image artefact without a full blob falls back to the thumbnail blob', () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
  const { blob: _omitted, ...rest } = imageRow;
  const v = artefactToViewable(rest);
  expect(v.imageUrl).toBe('blob:thumb');
  expect(createUrl).toHaveBeenCalledWith(imageRow.thumbBlob);
  createUrl.mockRestore();
});

test('artefactToViewable carries tags and enables editTags; attachments do not', async () => {
  const { artefactToViewable } = await import('../../src/components/lightbox/viewable-item.js');
  const v = artefactToViewable({
    id: 'a',
    chatId: 'c',
    personaId: 'p',
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title: 'T',
    fileName: 't.html',
    mime: 'text/html',
    content: '<x>',
    tags: ['demo'],
    favourite: false,
    createdAt: 0,
    updatedAt: 0,
  });
  expect(v.tags).toEqual(['demo']);
  expect(v.caps.editTags).toBe(true);
});
