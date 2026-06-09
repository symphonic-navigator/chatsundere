// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Lightbox } from '../../src/components/lightbox/Lightbox.js';
import { downloadText, downloadUrl } from '../../src/components/lightbox/lightbox-actions';
import {
  type ViewableItem,
  artefactToViewable,
} from '../../src/components/lightbox/viewable-item.js';

vi.mock('../../src/components/lightbox/lightbox-actions', () => ({
  copyText: vi.fn(),
  downloadText: vi.fn(),
  downloadUrl: vi.fn(),
}));

const item: ViewableItem = {
  id: 'a1',
  kind: 'text',
  fileName: 'calc.html',
  title: 'Calc',
  mime: 'text/html',
  text: '<x>',
  caps: {
    rename: true,
    remove: false,
    copy: true,
    download: true,
    delete: true,
    editSource: true,
    editTags: true,
  },
};

test('renders a delete control and fires onDelete', () => {
  const onDelete = vi.fn();
  render(
    <Lightbox
      items={[item]}
      index={0}
      onRename={vi.fn()}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onDelete={onDelete}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(onDelete).toHaveBeenCalledWith('a1');
});

test('renames title and fileName independently via onRename patch', () => {
  const onRename = vi.fn();
  render(
    <Lightbox
      items={[item]}
      index={0}
      onRename={onRename}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  // title shown when present; clicking it opens the title editor
  fireEvent.click(screen.getByRole('button', { name: /rename title/i }));
  const input = screen.getByDisplayValue('Calc');
  fireEvent.change(input, { target: { value: 'New' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledWith('a1', { title: 'New' });
});

test('lightbox renders a tag editor for artefacts and calls onSetTags', () => {
  const onSetTags = vi.fn();
  const item = artefactToViewable({
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
    tags: [],
    favourite: false,
    createdAt: 0,
    updatedAt: 0,
  });
  render(
    <Lightbox
      items={[item]}
      index={0}
      tagSuggestions={['prod']}
      onSetTags={onSetTags}
      onRename={vi.fn()}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByPlaceholderText('Add a tag…');
  fireEvent.change(input, { target: { value: 'demo' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSetTags).toHaveBeenCalledWith('a', ['demo']);
});

test('provenance line renders a copy button that writes the provenance to the clipboard', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:full');
  const item = artefactToViewable({
    id: 'i2',
    chatId: 'c1',
    personaId: 'p1',
    projectId: null,
    origin: 'generated',
    kind: 'image',
    format: 'image',
    title: 'An owl',
    fileName: 'an-owl.jpg',
    mime: 'image/jpeg',
    content: '',
    tags: [],
    favourite: false,
    createdAt: 0,
    updatedAt: 0,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    genMeta: {
      prompt: 'a snowy owl',
      modelRef: 'nano-gpt:z-image-turbo',
      modelLabel: 'Z-Image',
      configSnapshot: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
    },
  });
  render(
    <Lightbox
      items={[item]}
      index={0}
      onRename={vi.fn()}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  // Provenance copy button is present.
  const provenance = screen.getByLabelText('Source');
  expect(provenance).toBeTruthy();
  const copyBtn = provenance.querySelector('button[type="button"]');
  expect(copyBtn).toBeTruthy();
  // Clicking it writes the provenance string to the clipboard.
  fireEvent.click(copyBtn as Element);
  expect(writeText).toHaveBeenCalledWith('a snowy owl — via Z-Image');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('image artefact shows its provenance and downloads via the object URL', () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:full');
  const item = artefactToViewable({
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
    tags: [],
    favourite: false,
    createdAt: 0,
    updatedAt: 0,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    genMeta: {
      prompt: 'a fox',
      modelRef: 'nano-gpt:z-image-turbo',
      modelLabel: 'Z-Image',
      configSnapshot: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
    },
  });
  render(
    <Lightbox
      items={[item]}
      index={0}
      onRename={vi.fn()}
      onRemove={vi.fn()}
      onEditText={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  // The generation prompt is user-visible above the image.
  expect(screen.getByText('a fox — via Z-Image')).toBeTruthy();
  expect(screen.getByAltText('a-fox.jpg').getAttribute('src')).toBe('blob:full');
  // Download routes through the existing object URL, not the empty text draft.
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(vi.mocked(downloadUrl)).toHaveBeenCalledWith('blob:full', 'a-fox.jpg');
  expect(vi.mocked(downloadText)).not.toHaveBeenCalled();
  createUrl.mockRestore();
});
