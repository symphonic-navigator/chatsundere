// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneArchive } from './archive-reader.js';
import { SUPPORTED_VERSION } from './persona-parse.js';
import type { ChatsuneDocumentJson, ChatsuneLibraryJson } from './types.js';

export const IMPORT_FORMAT_KNOWLEDGE = 'chatsune/knowledge';

export interface ParsedKnowledgeExport {
  name: string;
  description: string;
  nsfw: boolean;
  documents: { title: string; content: string; triggerPhrases: string[] }[];
}

function decodeJson<T>(files: Map<string, Uint8Array>, name: string): T | undefined {
  const bytes = files.get(name);
  if (!bytes) return undefined;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Parse a chatsune knowledge export into a Chatsundere library + documents (spec §7). */
export function parseKnowledgeExport(archive: ChatsuneArchive): ParsedKnowledgeExport {
  if (archive.manifest.format !== IMPORT_FORMAT_KNOWLEDGE) {
    throw new Error('This is not a knowledge export — pick a Chatsune library file.');
  }
  if (archive.manifest.version > SUPPORTED_VERSION) {
    throw new Error(
      'This export is from a newer version of Chatsune than this importer understands.',
    );
  }
  const lib = decodeJson<ChatsuneLibraryJson>(archive.files, 'library.json');
  if (!lib) throw new Error('This knowledge export is incomplete (no library data).');
  const docs = decodeJson<ChatsuneDocumentJson[]>(archive.files, 'documents.json') ?? [];

  return {
    name: lib.name ?? 'Imported library',
    description: lib.description ?? '',
    nsfw: !!lib.nsfw,
    documents: docs.map((d) => ({
      title: d.title,
      content: d.content,
      triggerPhrases: Array.isArray(d.trigger_phrases) ? d.trigger_phrases : [],
    })),
  };
}
