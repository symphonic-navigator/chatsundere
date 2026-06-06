// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { fenceToArtefactMeta } from '../../src/lib/fence-to-artefact.js';

test('html → renderable html artefact', () => {
  expect(fenceToArtefactMeta('html')).toEqual({ format: 'html', mime: 'text/html', ext: 'html' });
  expect(fenceToArtefactMeta('HTML')).toEqual({ format: 'html', mime: 'text/html', ext: 'html' });
  expect(fenceToArtefactMeta('htm')).toEqual({ format: 'html', mime: 'text/html', ext: 'html' });
});

test('svg and mermaid map to their structural formats', () => {
  expect(fenceToArtefactMeta('svg')).toEqual({ format: 'svg', mime: 'image/svg+xml', ext: 'svg' });
  expect(fenceToArtefactMeta('mermaid')).toEqual({
    format: 'mermaid',
    mime: 'text/plain',
    ext: 'mmd',
  });
});

test('known languages map to their conventional extension', () => {
  expect(fenceToArtefactMeta('python')).toMatchObject({ format: 'code', ext: 'py' });
  expect(fenceToArtefactMeta('typescript')).toMatchObject({ format: 'code', ext: 'ts' });
  expect(fenceToArtefactMeta('csharp')).toMatchObject({ format: 'code', ext: 'cs' });
  expect(fenceToArtefactMeta('bash')).toMatchObject({ format: 'code', ext: 'sh' });
});

test('an unknown but token-safe language uses the token itself as extension', () => {
  expect(fenceToArtefactMeta('zig')).toEqual({ format: 'code', mime: 'text/plain', ext: 'zig' });
});

test('a non-token language falls back to txt', () => {
  expect(fenceToArtefactMeta('c++')).toMatchObject({ format: 'code', ext: 'txt' });
  expect(fenceToArtefactMeta('')).toMatchObject({ format: 'code', ext: 'txt' });
});

test('markdown fence is a first-class markdown artefact', () => {
  expect(fenceToArtefactMeta('markdown')).toEqual({
    format: 'markdown',
    mime: 'text/markdown',
    ext: 'md',
  });
  expect(fenceToArtefactMeta('md')).toEqual({
    format: 'markdown',
    mime: 'text/markdown',
    ext: 'md',
  });
});
