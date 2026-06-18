// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ChatsuneArchive } from '../../../src/lib/chatsune-import/archive-reader.js';
import { parsePersonaExport } from '../../../src/lib/chatsune-import/persona-parse.js';

function file(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function archive(
  manifest: Partial<ChatsuneArchive['manifest']> & { format: string; version: number },
  files: Record<string, Uint8Array>,
): ChatsuneArchive {
  return {
    manifest: manifest as ChatsuneArchive['manifest'],
    files: new Map(Object.entries(files)),
  };
}

describe('parsePersonaExport', () => {
  it('extracts persona core fields, sessions, and avatar crop', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 1 },
      {
        'persona.json': file({
          name: 'Fable',
          tagline: 'Your companion',
          system_prompt: 'You are Fable.',
          nsfw: true,
          profile_crop: { x: 0, y: 0, zoom: 220 / 800, width: 800, height: 800 },
          has_avatar: true,
        }),
        'profile_image.png': new Uint8Array([1, 2, 3]),
        'sessions.json': file({
          sessions: [{ original_id: 's1', session_fields: {}, messages: [] }],
        }),
      },
    );
    const out = parsePersonaExport(arc);
    expect(out.persona).toEqual({
      name: 'Fable',
      tagline: 'Your companion',
      instructions: 'You are Fable.',
      nsfw: true,
    });
    expect(out.sessions).toHaveLength(1);
    expect(out.avatar?.mime).toBe('image/png');
    expect(out.avatar?.crop.zoom).toBeCloseTo(1, 5);
    expect(out.memoryCount).toBe(0);
  });

  it('counts memories from memory.json (the future-import tripwire)', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 1 },
      {
        'persona.json': file({ name: 'A', tagline: '', system_prompt: '', nsfw: false }),
        'sessions.json': file({ sessions: [] }),
        'memory.json': file({ journal_entries: [{}, {}, {}], memory_bodies: [{}] }),
      },
    );
    expect(parsePersonaExport(arc).memoryCount).toBe(4);
  });

  it('returns avatar null when has_avatar is false', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 1 },
      {
        'persona.json': file({
          name: 'A',
          tagline: '',
          system_prompt: '',
          nsfw: false,
          has_avatar: false,
        }),
        'sessions.json': file({ sessions: [] }),
      },
    );
    expect(parsePersonaExport(arc).avatar).toBeNull();
  });

  it('rejects a knowledge archive', () => {
    const arc = archive({ format: 'chatsune/knowledge', version: 1 }, {});
    expect(() => parsePersonaExport(arc)).toThrow(/not a persona export/i);
  });

  it('rejects an unsupported newer version', () => {
    const arc = archive(
      { format: 'chatsune/persona', version: 2 },
      { 'persona.json': file({ name: 'A', tagline: '', system_prompt: '', nsfw: false }) },
    );
    expect(() => parsePersonaExport(arc)).toThrow(/newer version/i);
  });
});
