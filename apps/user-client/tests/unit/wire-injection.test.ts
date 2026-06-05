// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { type ResolvedPart, buildUserWireContent } from '../../src/attachments/wire-injection.js';

describe('buildUserWireContent', () => {
  it('returns a plain string when there are no attachments', () => {
    expect(buildUserWireContent('hi', [])).toBe('hi');
  });

  it('emits an image_url part with a naming text part for a direct image', () => {
    const parts: ResolvedPart[] = [
      { kind: 'image-direct', fileName: 'a.png', dataUrl: 'data:image/jpeg;base64,xxx' },
    ];
    expect(buildUserWireContent('look', parts)).toEqual([
      { type: 'text', text: 'look' },
      { type: 'text', text: '[Image: a.png]' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
    ]);
  });

  it('emits a description text part for a substituted image', () => {
    const parts: ResolvedPart[] = [
      { kind: 'image-description', fileName: 'a.png', model: 'p:v', description: 'a cat' },
    ];
    expect(buildUserWireContent('', parts)).toEqual([
      { type: 'text', text: '[Image description for a.png (via p:v):\na cat\n]' },
    ]);
  });

  it('emits a placeholder for a blind image', () => {
    const parts: ResolvedPart[] = [{ kind: 'image-placeholder', fileName: 'a.png' }];
    expect(buildUserWireContent('', parts)).toEqual([
      { type: 'text', text: '[Image: a.png — current model cannot see images, image omitted]' },
    ]);
  });

  it('emits a filename-headed fenced block for a text attachment', () => {
    const parts: ResolvedPart[] = [{ kind: 'text', fileName: 'n.md', text: '# Title' }];
    expect(buildUserWireContent('read this', parts)).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'text', text: 'Attachment: n.md\n```\n# Title\n```' },
    ]);
  });
});
