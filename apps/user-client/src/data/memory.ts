// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemoryJournalState } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import {
  commitEntry,
  countJournal,
  countUnextractedUserMessages,
  getCurrentBody,
  listBodyVersions,
  listJournal,
  rollbackBody,
  saveBody,
  updateEntryContent,
} from '../memory/repo.js';
import { type TrashUndoHandle, softDelete } from '../trash/delete-flow.js';
import { showDeleteToast } from '../trash/delete-toast.js';
import { QK } from './queryKeys.js';

export function useUncommittedCount(personaId: string) {
  return useQuery({
    queryKey: QK.memoryUncommittedCount(personaId),
    queryFn: () => countJournal(personaId, 'uncommitted'),
  });
}

export function useJournalEntries(personaId: string, state: MemoryJournalState) {
  return useQuery({
    queryKey: QK.memoryJournal(personaId, state),
    queryFn: () => listJournal(personaId, state),
  });
}

export function useCommittedEntries(personaId: string) {
  return useQuery({
    queryKey: QK.memoryCommitted(personaId),
    queryFn: () => listJournal(personaId, 'committed'),
  });
}

export function useCurrentBody(personaId: string) {
  // Coalesce undefined → null: TanStack Query v5 rejects undefined as query data.
  return useQuery({
    queryKey: QK.memoryBody(personaId),
    queryFn: () => getCurrentBody(personaId).then((b) => b ?? null),
  });
}

export function useBodyVersions(personaId: string) {
  return useQuery({
    queryKey: QK.memoryBodyVersions(personaId),
    queryFn: () => listBodyVersions(personaId),
  });
}

export function useUnextractedCount(chatId: string) {
  return useQuery({
    queryKey: QK.unextractedCount(chatId),
    queryFn: () => countUnextractedUserMessages(chatId),
  });
}

function useMemoryMutation<T>(personaId: string, fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.memory(personaId) });
    },
  });
}

export function useCommitEntry(personaId: string) {
  return useMemoryMutation<string>(personaId, (id) => commitEntry(id));
}

export function useRejectEntry(personaId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: QK.memory(personaId) });
    void qc.invalidateQueries({ queryKey: ['trash-cards'] });
  };
  return useMutation({
    mutationFn: (id: string): Promise<TrashUndoHandle> => softDelete('memoryJournal', id),
    onSuccess: (handle, id) => {
      invalidate();
      showDeleteToast('memoryJournal', id, handle, invalidate);
    },
  });
}

export function useUpdateEntry(personaId: string) {
  return useMemoryMutation<{ id: string; content: string }>(personaId, ({ id, content }) =>
    updateEntryContent(id, content),
  );
}

export function useSaveBodyManual(personaId: string) {
  return useMemoryMutation<string>(personaId, (content) =>
    saveBody(personaId, content, 0, 'manual'),
  );
}

export function useRollbackBody(personaId: string) {
  return useMemoryMutation<number>(personaId, (version) => rollbackBody(personaId, version));
}

export function useMarkMemoryViewed(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) =>
      getClientDataDb().personas.update(personaId, { lastViewedMemoryBodyVersion: version }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.persona(personaId) });
    },
  });
}
