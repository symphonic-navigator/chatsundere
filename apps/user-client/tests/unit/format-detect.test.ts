// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  type PreviewFormat,
  detectFormat,
  extensionToLang,
  formatToExtension,
} from '../../src/components/lightbox/format-detect';

describe('detectFormat', () => {
  it('detects markdown by extension and mime', () => {
    expect(detectFormat('notes.md', '')).toBe<PreviewFormat>('markdown');
    expect(detectFormat('x', 'text/markdown')).toBe('markdown');
  });
  it('detects svg by extension and mime', () => {
    expect(detectFormat('logo.svg', '')).toBe('svg');
    expect(detectFormat('x', 'image/svg+xml')).toBe('svg');
  });
  it('detects html by extension and mime', () => {
    expect(detectFormat('page.HTML', '')).toBe('html');
    expect(detectFormat('x', 'text/html')).toBe('html');
  });
  it('detects mermaid by extension', () => {
    expect(detectFormat('flow.mmd', '')).toBe('mermaid');
    expect(detectFormat('flow.mermaid', '')).toBe('mermaid');
  });
  it('detects code by a known programming extension', () => {
    expect(detectFormat('app.ts', '')).toBe('code');
    expect(detectFormat('main.py', '')).toBe('code');
    expect(detectFormat('Component.tsx', '')).toBe('code');
  });
  it('falls back to plain for unknown/no extension', () => {
    expect(detectFormat('README', '')).toBe('plain');
    expect(detectFormat('data.txt', 'text/plain')).toBe('plain');
  });
});

describe('extensionToLang', () => {
  it('maps known extensions to shiki language ids', () => {
    expect(extensionToLang('app.ts')).toBe('typescript');
    expect(extensionToLang('Component.tsx')).toBe('tsx');
    expect(extensionToLang('main.py')).toBe('python');
    expect(extensionToLang('style.css')).toBe('css');
  });
  it('falls back to "text" for unknown extensions', () => {
    expect(extensionToLang('mystery.zzz')).toBe('text');
  });
});

describe('formatToExtension', () => {
  it('keeps the original filename extension when present', () => {
    expect(formatToExtension('app.ts', 'code')).toBe('app.ts');
  });
  it('appends a sensible extension when the name has none', () => {
    expect(formatToExtension('diagram', 'mermaid')).toBe('diagram.mmd');
    expect(formatToExtension('doc', 'markdown')).toBe('doc.md');
  });
});
