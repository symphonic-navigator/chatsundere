// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { MediaRef } from '../../src/mcp/media-extract.js';
import { type MediaItem, modelLineFor, titleFor } from '../../src/mcp/media-items.js';

const ref = (over: Partial<MediaRef> = {}): MediaRef => ({
  key: 'gen:G1',
  kind: 'audio',
  mime: 'audio/mpeg',
  source: { kind: 'url', url: 'https://cdn.example/a.mp3' },
  expiresAt: null,
  providerName: null,
  ...over,
});

const item = (key: string, status: MediaItem['status'], over: Partial<MediaItem> = {}) =>
  ({ key, kind: 'audio', mime: 'audio/mpeg', title: 'Audio 1', status, ...over }) as MediaItem;

describe('titleFor', () => {
  it('numbers files by kind when there is no provider name', () => {
    expect(titleFor(ref(), 1, 2)).toBe('Audio 1');
    expect(titleFor(ref(), 2, 2)).toBe('Audio 2');
    expect(titleFor(ref({ kind: 'video' }), 2, 3)).toBe('Video 2');
    expect(titleFor(ref(), 1, 1)).toBe('Audio 1');
  });

  it('ignores a generic provider name', () => {
    expect(titleFor(ref({ providerName: 'content.mp3' }), 1, 1)).toBe('Audio 1');
    expect(titleFor(ref({ providerName: '0123abcd4567ef.mp3' }), 3, 3)).toBe('Audio 3');
  });

  it('uses a provider name a person chose', () => {
    expect(titleFor(ref({ providerName: 'Morning Birdsong' }), 1, 1)).toBe('Morning Birdsong');
  });
});

describe('modelLineFor', () => {
  it('maps saved files and names the failed one with its cause', () => {
    const line = modelLineFor([
      item('gen:G1', 'saved', { title: 'Audio 1', artefactId: 'a1' }),
      item('gen:G2', 'saved', { title: 'Audio 2', artefactId: 'a2' }),
      item('gen:G3', 'failed', { title: 'Audio 3', cause: 'unreachable' }),
    ]);
    expect(line).toBe(
      'Shown to the user as players: Audio 1 = generation G1, Audio 2 = generation G2. Audio 3 could not be saved (could not reach the file). Refer to them by these names in prose; do not repeat their URLs.',
    );
  });

  it('says which files are still being saved', () => {
    const line = modelLineFor([
      item('gen:G1', 'saved', { title: 'Audio 1' }),
      item('gen:G2', 'saved', { title: 'Audio 2' }),
      item('gen:G3', 'saving', { title: 'Audio 3' }),
    ]);
    expect(line).toContain(
      'Audio 3 = generation G3. Audio 3 is still being saved and appears when ready.',
    );
  });

  it('says which files repeat ones already shown', () => {
    const line = modelLineFor([
      item('gen:G1', 'duplicate', { title: 'Audio 1' }),
      item('gen:G2', 'duplicate', { title: 'Audio 2' }),
    ]);
    expect(line).toContain('Audio 1 and Audio 2 are the same files already shown above.');
  });

  it('names the earlier file a duplicate repeats when its title is known', () => {
    const line = modelLineFor(
      [
        item('gen:G1', 'saved', { title: 'Audio 1', artefactId: 'a1' }),
        item('gen:G2', 'duplicate', { title: 'Audio 2', artefactId: 'a0' }),
        item('gen:G3', 'duplicate', { title: 'Audio 3', artefactId: 'ax' }),
      ],
      new Map([['a0', 'Morning Birdsong']]),
    );
    expect(line).toContain(
      'Audio 2 here is the same file as "Morning Birdsong" shown above. Audio 3 is the same file already shown above.',
    );
  });

  it('names URL-keyed files by their position', () => {
    const line = modelLineFor([
      item('url:https://cdn.example/a.mp3', 'saved', { title: 'Audio 1' }),
      item('url:https://cdn.example/b.mp3', 'saved', { title: 'Audio 2' }),
    ]);
    expect(line).toContain('Audio 1 = file 1, Audio 2 = file 2.');
    expect(line).not.toContain('https:');
  });

  it('reports refused files and an all-failed result truthfully', () => {
    const line = modelLineFor([
      item('gen:G1', 'failed', { title: 'Audio 1', cause: 'expired', refused: 2 }),
      item('gen:G2', 'failed', { title: 'Audio 2', cause: 'wrong-type' }),
    ]);
    expect(line).toBe(
      'No file could be shown to the user. Audio 1 could not be saved (the link had expired). Audio 2 could not be saved (it was not the audio or video it claimed to be). 2 files were not shown: unsupported type. Do not repeat their URLs.',
    );
  });
});
