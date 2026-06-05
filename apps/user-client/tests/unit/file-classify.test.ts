// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyFile } from '../../src/attachments/file-classify.js';

function file(name: string, type: string, size = 100): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('classifyFile', () => {
  it('accepts supported images as kind image', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toEqual({ ok: true, kind: 'image' });
    expect(classifyFile(file('a.webp', 'image/webp'))).toEqual({ ok: true, kind: 'image' });
  });

  it('accepts text/markdown/code as kind text (by mime or extension)', () => {
    expect(classifyFile(file('n.md', 'text/markdown'))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(file('s.ts', ''))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(file('p.txt', 'text/plain'))).toEqual({ ok: true, kind: 'text' });
  });

  it('rejects unsupported types with a reason', () => {
    const r = classifyFile(file('d.pdf', 'application/pdf'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PDF|not supported|images and text/i);
  });

  it('rejects oversize files', () => {
    expect(classifyFile(file('big.png', 'image/png', 11 * 1024 * 1024)).ok).toBe(false);
    expect(classifyFile(file('big.txt', 'text/plain', 2 * 1024 * 1024)).ok).toBe(false);
  });
});
