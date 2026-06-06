// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyFile } from '../../src/attachments/file-classify.js';

function file(name: string, type: string, size = 100): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

function svgFile(name: string, type: string): File {
  return new File(['<svg/>'], name, { type });
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

describe('classifyFile — svg & mermaid', () => {
  it('accepts an .svg as text (XML), even with the image/svg+xml mime', () => {
    expect(classifyFile(svgFile('logo.svg', 'image/svg+xml'))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(svgFile('logo.svg', ''))).toEqual({ ok: true, kind: 'text' });
  });
  it('accepts .mmd and .mermaid as text', () => {
    expect(classifyFile(svgFile('flow.mmd', ''))).toEqual({ ok: true, kind: 'text' });
    expect(classifyFile(svgFile('flow.mermaid', ''))).toEqual({ ok: true, kind: 'text' });
  });
  it('still rejects an unsupported binary type', () => {
    const r = classifyFile(svgFile('a.bin', 'application/octet-stream'));
    expect(r.ok).toBe(false);
  });
});
