// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AvatarCrop, type PersonaAvatarRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** Read a persona's avatar row, or null when none is set. */
export function usePersonaAvatar(personaId: string | null) {
  return useQuery({
    queryKey: personaId ? QK.personaAvatar(personaId) : ['persona-avatar', '__none'],
    enabled: personaId !== null,
    queryFn: async () => {
      if (!personaId) return null;
      return (await getClientDataDb().personaAvatars.get(personaId)) ?? null;
    },
  });
}

export interface SetAvatarArgs {
  personaId: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  crop: AvatarCrop;
}

/** Create or replace a persona's avatar. */
export function useSetPersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: SetAvatarArgs) => {
      const row: PersonaAvatarRow = { ...args, updatedAt: Date.now() };
      await getClientDataDb().personaAvatars.put(row);
    },
    onSuccess: (_v, args) => qc.invalidateQueries({ queryKey: QK.personaAvatar(args.personaId) }),
  });
}

/** Remove a persona's avatar (back to the monogram). */
export function useRemovePersonaAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (personaId: string) => {
      await getClientDataDb().personaAvatars.delete(personaId);
    },
    onSuccess: (_v, personaId) => qc.invalidateQueries({ queryKey: QK.personaAvatar(personaId) }),
  });
}
