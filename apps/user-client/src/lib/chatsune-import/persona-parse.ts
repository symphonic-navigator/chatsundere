// SPDX-License-Identifier: AGPL-3.0-only

import type { AvatarCrop } from '../../boot/client-data-db.js';
import type { ChatsuneArchive } from './archive-reader.js';
import { convertChatsuneCrop } from './crop-convert.js';
import type {
  ChatsuneMemoryExport,
  ChatsunePersonaJson,
  ChatsuneSessionExport,
  ChatsuneSessionsBundle,
} from './types.js';

export const IMPORT_FORMAT_PERSONA = 'chatsune/persona';
export const SUPPORTED_VERSION = 1;

export interface ParsedAvatar {
  bytes: Uint8Array;
  mime: string;
  crop: AvatarCrop;
}

export interface ParsedPersonaExport {
  persona: { name: string; tagline: string; instructions: string; nsfw: boolean };
  avatar: ParsedAvatar | null;
  sessions: ChatsuneSessionExport[];
  /** Count of chatsune memories in the export (journal entries + body versions). */
  memoryCount: number;
  /** The parsed chatsune memory, or null when the export carries none. */
  memory: ChatsuneMemoryExport | null;
}

const AVATAR_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function decodeJson<T>(files: Map<string, Uint8Array>, name: string): T | undefined {
  const bytes = files.get(name);
  if (!bytes) return undefined;
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function findAvatar(files: Map<string, Uint8Array>): { bytes: Uint8Array; mime: string } | null {
  for (const [name, bytes] of files) {
    const m = /^profile_image\.([a-z0-9]+)$/i.exec(name);
    const ext = m?.[1]?.toLowerCase();
    if (ext && AVATAR_MIME[ext]) return { bytes, mime: AVATAR_MIME[ext] };
  }
  return null;
}

/** Parse a chatsune persona export into Chatsundere-shaped pieces (spec §5). */
export function parsePersonaExport(archive: ChatsuneArchive): ParsedPersonaExport {
  if (archive.manifest.format !== IMPORT_FORMAT_PERSONA) {
    throw new Error('This is not a persona export — pick a Chatsune persona file.');
  }
  if (archive.manifest.version > SUPPORTED_VERSION) {
    throw new Error(
      'This export is from a newer version of Chatsune than this importer understands.',
    );
  }
  const personaJson = decodeJson<ChatsunePersonaJson>(archive.files, 'persona.json');
  if (!personaJson) throw new Error('This persona export is incomplete (no persona data).');

  const sessionsBundle = decodeJson<ChatsuneSessionsBundle>(archive.files, 'sessions.json');
  const sessions = sessionsBundle?.sessions ?? [];

  const memoryRaw = decodeJson<ChatsuneMemoryExport>(archive.files, 'memory.json');
  const memory: ChatsuneMemoryExport | null = memoryRaw
    ? {
        journal_entries: Array.isArray(memoryRaw.journal_entries) ? memoryRaw.journal_entries : [],
        memory_bodies: Array.isArray(memoryRaw.memory_bodies) ? memoryRaw.memory_bodies : [],
      }
    : null;
  const memoryCount = (memory?.journal_entries.length ?? 0) + (memory?.memory_bodies.length ?? 0);

  let avatar: ParsedAvatar | null = null;
  if (personaJson.has_avatar !== false) {
    const found = findAvatar(archive.files);
    if (found) {
      const crop = personaJson.profile_crop
        ? convertChatsuneCrop(personaJson.profile_crop)
        : { x: 0, y: 0, zoom: 1 };
      avatar = { bytes: found.bytes, mime: found.mime, crop };
    }
  }

  return {
    persona: {
      name: personaJson.name,
      tagline: personaJson.tagline ?? '',
      instructions: personaJson.system_prompt ?? '',
      nsfw: !!personaJson.nsfw,
    },
    avatar,
    sessions,
    memoryCount,
    memory,
  };
}
