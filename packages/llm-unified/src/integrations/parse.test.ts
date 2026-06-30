// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { findIntegrationTags, parseIntegrationTag } from './parse.js';

describe('parseIntegrationTag', () => {
  it('extracts prefix, command and raw args verbatim', () => {
    expect(parseIntegrationTag('sfx:emoji-shower 🔥🦊💖')).toEqual({
      prefix: 'sfx',
      command: 'emoji-shower',
      rawArgs: '🔥🦊💖',
    });
  });

  it('does not tokenise rawArgs (keeps spaces verbatim)', () => {
    expect(parseIntegrationTag('sfx:emoji-shower 🔥 🦊 💖')?.rawArgs).toBe('🔥 🦊 💖');
  });

  it('returns null when there is no prefix:command head', () => {
    expect(parseIntegrationTag('laugh')).toBeNull();
    expect(parseIntegrationTag('sfx:emoji-shower')).toBeNull(); // no space + args
  });
});

describe('findIntegrationTags', () => {
  it('locates each tag with its start index and raw match', () => {
    const tags = findIntegrationTags('hey [sfx:emoji-shower 🔥] there [sfx:emoji-shower 💖]');
    // Indices are UTF-16 code-unit offsets (RegExp.index semantics); 🔥 is a
    // surrogate pair, so the second tag starts at 32, not 31.
    expect(tags.map((t) => t.index)).toEqual([4, 32]);
    expect(tags[0]?.raw).toBe('[sfx:emoji-shower 🔥]');
    expect(tags[1]?.command).toBe('emoji-shower');
  });

  it('ignores TEAL-style and ordinary brackets', () => {
    expect(findIntegrationTags('a [laugh] b [link](url) c')).toEqual([]);
  });
});
