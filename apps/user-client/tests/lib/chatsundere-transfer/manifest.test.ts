import { describe, expect, it } from 'vitest';
import { detectArchiveFormat } from '../../../src/lib/chatsundere-transfer/manifest.js';

describe('detectArchiveFormat', () => {
  it('recognises both Chatsundere formats', () => {
    expect(detectArchiveFormat({ format: 'chatsundere/persona' })).toBe('chatsundere/persona');
    expect(detectArchiveFormat({ format: 'chatsundere/knowledge' })).toBe('chatsundere/knowledge');
  });
  it('recognises the Chatsune bridge formats', () => {
    expect(detectArchiveFormat({ format: 'chatsune/persona' })).toBe('chatsune/persona');
    expect(detectArchiveFormat({ format: 'chatsune/knowledge' })).toBe('chatsune/knowledge');
  });
  it('returns unknown for anything else', () => {
    expect(detectArchiveFormat({ format: 'whatever' })).toBe('unknown');
    expect(detectArchiveFormat({})).toBe('unknown');
    expect(detectArchiveFormat(null)).toBe('unknown');
  });
});
