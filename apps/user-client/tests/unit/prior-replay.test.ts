// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  IMAGE_TOKEN_ESTIMATE,
  PRIOR_IMAGE_TURN_WINDOW,
  estimateAttachmentTokens,
  imageWindowMessageIds,
  resolveEarlierParts,
} from '../../src/attachments/prior-replay.js';
import { resolveAttachmentParts } from '../../src/attachments/resolve-send.js';
import type { AttachmentRow } from '../../src/boot/client-data-db.js';
import { estimateTokens } from '../../src/lib/token-estimator.js';

const row = (over: Partial<AttachmentRow> = {}): AttachmentRow =>
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

describe('imageWindowMessageIds', () => {
  it('returns the last three image turns, ignoring text-only and deleted-only turns', () => {
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    const byMessage = new Map<string, AttachmentRow[]>([
      ['m1', [row({ messageId: 'm1' })]],
      ['m2', [row({ messageId: 'm2' })]],
      ['m3', [row({ messageId: 'm3' })]],
      ['m4', [row({ messageId: 'm4' })]],
      ['m5', [row({ messageId: 'm5' })]],
      ['m6', [row({ messageId: 'm6', kind: 'text', text: 'hi' })]],
      ['m7', [row({ messageId: 'm7', state: 'deleted' })]],
    ]);
    expect(PRIOR_IMAGE_TURN_WINDOW).toBe(3);
    expect(imageWindowMessageIds(ids, byMessage)).toEqual(new Set(['m3', 'm4', 'm5']));
  });
});

describe('resolveEarlierParts', () => {
  it('keeps text, uses cached descriptions, otherwise a shown-earlier marker, skips deleted', () => {
    const parts = resolveEarlierParts([
      row({ id: 't', kind: 'text', fileName: 'doc.md', text: 'hello', blob: undefined }),
      row({
        id: 'i1',
        fileName: 'a.png',
        visionDescription: { model: 'x:y', text: 'A cat.' },
      }),
      row({ id: 'i2', fileName: 'b.png' }),
      row({ id: 'i3', fileName: 'c.png', state: 'deleted' }),
    ]);
    expect(parts).toEqual([
      { kind: 'text', fileName: 'doc.md', text: 'hello' },
      { kind: 'image-description', fileName: 'a.png', model: 'x:y', description: 'A cat.' },
      { kind: 'image-earlier', fileName: 'b.png' },
    ]);
  });
});

describe('resolveAttachmentParts missingBlob option', () => {
  const deps = {
    toDataUrl: async () => 'data:,',
    describe: async () => 'A cat.',
    cacheDescription: async () => {},
  };

  it('emits image-earlier for a blob-less image when asked', async () => {
    expect(
      await resolveAttachmentParts([row({ blob: undefined })], 'direct', null, deps, {
        missingBlob: 'earlier',
      }),
    ).toEqual([{ kind: 'image-earlier', fileName: 'cat.jpg' }]);
  });

  it('skips a blob-less image by default', async () => {
    expect(await resolveAttachmentParts([row({ blob: undefined })], 'direct', null, deps)).toEqual(
      [],
    );
  });
});

describe('estimateAttachmentTokens', () => {
  it('counts every live image at the flat estimate and deleted rows as zero', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', state: 'deleted' })];
    expect(IMAGE_TOKEN_ESTIMATE).toBe(1000);
    expect(estimateAttachmentTokens(rows)).toBe(2000);
  });

  it('counts a text row as its rendered Attachment fence', () => {
    const t = row({ kind: 'text', fileName: 'notes.txt', text: 'hello there', mime: 'text/plain' });
    expect(estimateAttachmentTokens([t])).toBe(
      estimateTokens('Attachment: notes.txt\n```\nhello there\n```'),
    );
  });
});
