import type { SyncCollection } from '@chatsundere/shared-types';

/** The card class a trashed row belongs to (§3.3). */
export type TrashEntityKind = 'persona' | 'chat' | 'memory' | 'library' | 'document' | 'chatChild';

/** Grouping metadata a trashed row carries so the surface can render + restore it (§3.3). */
export interface TrashMeta {
  entityKind: TrashEntityKind;
  rootGroup: string;
  parentRef: { field: string; id: string } | null;
}

/**
 * Maps a `parentRef.field` to the parent's collection, so restore + grouping can
 * resolve a parentRef to the parent's trash key `${collection}:${id}` (§3.3/§3.5).
 */
export const PARENT_FIELD_COLLECTION: Record<string, SyncCollection> = {
  personaId: 'personas',
  chatId: 'chats',
  messageId: 'messages',
  libraryId: 'libraries',
};

/**
 * Descriptive parent → direct-children structural map (fk field per child),
 * reflecting the real cascade collectors (§3.2 + I-2). NOTE: the authoritative
 * snapshot SET for a delete comes from the existing cascade collectors (Task 7,
 * I-2), NOT from this constant — this documents ownership for grouping/restore.
 */
export const TRASH_HIERARCHY = {
  personas: [
    { collection: 'chats', field: 'personaId' },
    { collection: 'memoryJournal', field: 'personaId' },
    { collection: 'memoryBody', field: 'personaId' },
    { collection: 'personaAvatars', field: 'personaId' },
  ],
  chats: [
    { collection: 'messages', field: 'chatId' },
    { collection: 'attachments', field: 'chatId' },
    { collection: 'artefacts', field: 'chatId' },
  ],
  messages: [{ collection: 'pills', field: 'messageId' }],
  libraries: [{ collection: 'documents', field: 'libraryId' }],
} as const satisfies Record<string, ReadonlyArray<{ collection: SyncCollection; field: string }>>;

/** Read a string foreign key off an unknown row snapshot; empty string reads as absent. */
function readStr(row: unknown, field: string): string | null {
  // Snapshots are plaintext plain objects; index by field without asserting a shape.
  const record = (row ?? {}) as Record<string, unknown>;
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Derive grouping metadata from a collection + its live row snapshot.
 * `rootGroup` is the OWNER card group (`persona:<id>` | `library:<id>`), lifted as
 * far up the ownership chain as resolvable; `parentRef` is the IMMEDIATE parent.
 * For chat-children (messages/compactionCheckpoints/attachments/artefacts) pass
 * `resolvePersonaForChat` to lift rootGroup to the persona; without it (or when it
 * returns null) rootGroup falls back to `chats:<chatId>` (best-effort — cross-device
 * grouping edge cases are accepted spec §7 deferrals).
 */
export function deriveTrashMeta(
  collection: SyncCollection,
  key: string,
  row: unknown,
  resolvePersonaForChat?: (chatId: string) => string | null,
): TrashMeta {
  switch (collection) {
    case 'personas':
      return { entityKind: 'persona', rootGroup: `persona:${key}`, parentRef: null };

    case 'chats': {
      const pid = readStr(row, 'personaId');
      return pid
        ? {
            entityKind: 'chat',
            rootGroup: `persona:${pid}`,
            parentRef: { field: 'personaId', id: pid },
          }
        : { entityKind: 'chat', rootGroup: `chats:${key}`, parentRef: null };
    }

    case 'memoryJournal':
    case 'memoryBody': {
      const pid = readStr(row, 'personaId');
      return pid
        ? {
            entityKind: 'memory',
            rootGroup: `persona:${pid}`,
            parentRef: { field: 'personaId', id: pid },
          }
        : { entityKind: 'memory', rootGroup: `${collection}:${key}`, parentRef: null };
    }

    case 'libraries':
      return { entityKind: 'library', rootGroup: `library:${key}`, parentRef: null };

    case 'documents': {
      const lid = readStr(row, 'libraryId');
      return lid
        ? {
            entityKind: 'document',
            rootGroup: `library:${lid}`,
            parentRef: { field: 'libraryId', id: lid },
          }
        : { entityKind: 'document', rootGroup: `documents:${key}`, parentRef: null };
    }

    case 'messages':
    case 'compactionCheckpoints':
    case 'attachments':
    case 'artefacts': {
      const cid = readStr(row, 'chatId');
      if (!cid) {
        return { entityKind: 'chatChild', rootGroup: `${collection}:${key}`, parentRef: null };
      }
      // Lift to the persona card when a resolver returns a non-empty id, else the
      // best-effort chat group (a chat card renders only when the chat itself is trashed).
      const pid = resolvePersonaForChat?.(cid);
      return {
        entityKind: 'chatChild',
        rootGroup: pid ? `persona:${pid}` : `chats:${cid}`,
        parentRef: { field: 'chatId', id: cid },
      };
    }

    case 'pills': {
      const mid = readStr(row, 'messageId');
      // No deep resolver for pills — group under the immediate message (best-effort).
      return mid
        ? {
            entityKind: 'chatChild',
            rootGroup: `messages:${mid}`,
            parentRef: { field: 'messageId', id: mid },
          }
        : { entityKind: 'chatChild', rootGroup: `pills:${key}`, parentRef: null };
    }

    case 'personaAvatars':
      // The row is keyed by its persona id, so `key` IS the persona id.
      return {
        entityKind: 'chatChild',
        rootGroup: `persona:${key}`,
        parentRef: { field: 'personaId', id: key },
      };

    default:
      // Only the four trashable families + their children ever reach trash; a truly
      // unexpected collection gets an ungrouped top-level card.
      return { entityKind: 'chatChild', rootGroup: `${collection}:${key}`, parentRef: null };
  }
}
