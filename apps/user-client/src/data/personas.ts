// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import { type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/**
 * List all personas ordered by creation date (oldest first).
 * Sorted in memory because `createdAt` is not a Dexie index on the
 * personas store (only `id` and `providerId` are indexed per the schema).
 */
export function usePersonas() {
  return useQuery({
    queryKey: QK.personas,
    queryFn: async () => {
      const db = getClientDataDb();
      const rows = await db.personas.toArray();
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
  });
}

/**
 * Fetch a single persona by id. Returns `null` when the id is not in the
 * DB. Disabled (no fetch) when `id` is `null`.
 */
export function usePersona(id: string | null) {
  return useQuery({
    queryKey: id ? QK.persona(id) : ['personas', '__none'],
    queryFn: async () => {
      if (!id) return null;
      const db = getClientDataDb();
      return (await db.personas.get(id)) ?? null;
    },
    enabled: id !== null,
  });
}

type CreatePersonaArgs = Omit<PersonaRow, 'id' | 'createdAt' | 'updatedAt'>;

/** Create a new persona row and invalidate the list query on success. */
export function useCreatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreatePersonaArgs): Promise<PersonaRow> => {
      const db = getClientDataDb();
      const now = Date.now();
      const row: PersonaRow = { id: uuidv7(), createdAt: now, updatedAt: now, ...args };
      await db.personas.add(row);
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.personas }),
  });
}

/** Partially update a persona and invalidate both the list and single-row caches. */
export function useUpdatePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<Omit<PersonaRow, 'id' | 'createdAt'>>;
    }) => {
      const db = getClientDataDb();
      await db.personas.update(args.id, { ...args.patch, updatedAt: Date.now() });
    },
    onSuccess: (_v, args) => {
      qc.invalidateQueries({ queryKey: QK.personas });
      qc.invalidateQueries({ queryKey: QK.persona(args.id) });
    },
  });
}

/**
 * Delete a persona and cascade-delete all chats, messages, and pills that
 * belong to it, inside a single Dexie transaction.
 */
export function useDeletePersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = getClientDataDb();
      await db.transaction('rw', db.personas, db.chats, db.messages, db.pills, async () => {
        const chats = await db.chats.where('personaId').equals(id).toArray();
        const chatIds = chats.map((c) => c.id);
        if (chatIds.length > 0) {
          const messages = await db.messages.where('chatId').anyOf(chatIds).toArray();
          const messageIds = messages.map((m) => m.id);
          if (messageIds.length > 0) {
            await db.pills.where('messageId').anyOf(messageIds).delete();
          }
          await db.messages.where('chatId').anyOf(chatIds).delete();
          await db.chats.bulkDelete(chatIds);
        }
        await db.personas.delete(id);
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.personas });
      qc.invalidateQueries({ queryKey: QK.chats });
    },
  });
}
