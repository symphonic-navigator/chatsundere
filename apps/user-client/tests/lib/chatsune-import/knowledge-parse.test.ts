// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { ChatsuneArchive } from '../../../src/lib/chatsune-import/archive-reader.js';
import { parseKnowledgeExport } from '../../../src/lib/chatsune-import/knowledge-parse.js';
import type { ChatsuneManifest } from '../../../src/lib/chatsune-import/types.js';

function file(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}
function archive(manifest: ChatsuneManifest, files: Record<string, Uint8Array>): ChatsuneArchive {
  return { manifest, files: new Map(Object.entries(files)) };
}

describe('parseKnowledgeExport', () => {
  it('maps library and documents, preserving trigger phrases', () => {
    const arc = archive(
      { format: 'chatsune/knowledge' as const, version: 1 },
      {
        'library.json': file({
          name: 'Biology',
          description: 'core',
          nsfw: false,
          default_refresh: 'standard',
        }),
        'documents.json': file([
          {
            title: 'Photosynthesis',
            content: '# P',
            media_type: 'text/markdown',
            trigger_phrases: ['calvin'],
            refresh: 'often',
          },
        ]),
      },
    );
    const out = parseKnowledgeExport(arc);
    expect(out).toEqual({
      name: 'Biology',
      description: 'core',
      nsfw: false,
      documents: [{ title: 'Photosynthesis', content: '# P', triggerPhrases: ['calvin'] }],
    });
  });

  it('uses "Imported library" as a fallback when library.json omits name', () => {
    const arc = archive(
      { format: 'chatsune/knowledge' as const, version: 1 },
      {
        'library.json': file({ description: 'no name here', nsfw: false }),
        'documents.json': file([]),
      },
    );
    expect(parseKnowledgeExport(arc).name).toBe('Imported library');
  });

  it('rejects a persona archive', () => {
    expect(() =>
      parseKnowledgeExport(archive({ format: 'chatsune/persona' as const, version: 1 }, {})),
    ).toThrow(/not a knowledge export/i);
  });
});
