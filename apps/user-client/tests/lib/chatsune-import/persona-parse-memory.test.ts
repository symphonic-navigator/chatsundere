// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parsePersonaExport } from '../../../src/lib/chatsune-import/persona-parse.js';

// Mirror the archive shape parsePersonaExport consumes. Read persona-parse.ts to
// confirm the ChatsuneArchive shape (manifest + files map) and build a minimal one
// with manifest.json, persona.json, sessions.json, and memory.json.
function archiveWithMemory() {
  const files = new Map<string, Uint8Array>();
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  files.set(
    'manifest.json',
    enc({ format: 'chatsune/persona', version: 1, include_content: true }),
  );
  files.set('persona.json', enc({ name: 'P', tagline: '', system_prompt: '', nsfw: false }));
  files.set('sessions.json', enc({ sessions: [] }));
  files.set(
    'memory.json',
    enc({
      journal_entries: [
        {
          content: 'Likes tea',
          category: 'preference',
          state: 'committed',
          is_correction: false,
          created_at: '2026-01-01T00:00:00Z',
          committed_at: '2026-01-02T00:00:00Z',
          auto_committed: true,
        },
      ],
      memory_bodies: [
        {
          content: 'A consolidated body.',
          token_count: 5,
          version: 1,
          entries_processed: 3,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );
  return { manifest: { format: 'chatsune/persona', version: 1 }, files };
}

describe('parsePersonaExport — memory retention', () => {
  it('retains typed journal_entries + memory_bodies and still reports memoryCount', () => {
    // NOTE: adapt the archive constructor to the real ChatsuneArchive type read from persona-parse.ts.
    const parsed = parsePersonaExport(archiveWithMemory() as never);
    expect(parsed.memoryCount).toBe(2);
    expect(parsed.memory?.journal_entries).toHaveLength(1);
    expect(parsed.memory?.journal_entries[0]?.content).toBe('Likes tea');
    expect(parsed.memory?.memory_bodies[0]?.content).toBe('A consolidated body.');
  });

  it('memory is null when the export has no memory.json', () => {
    const a = archiveWithMemory();
    a.files.delete('memory.json');
    const parsed = parsePersonaExport(a as never);
    expect(parsed.memory).toBeNull();
    expect(parsed.memoryCount).toBe(0);
  });
});
