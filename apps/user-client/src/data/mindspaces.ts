// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MindspaceTexture, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** List all mindspace rows ordered alphabetically by display name. */
export function useMindspaces() {
  return useQuery({
    queryKey: QK.mindspaces,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.mindspaces.orderBy('displayName').toArray();
    },
  });
}

/** Update the texture variant for a single mindspace (built-in or custom). */
export function useUpdateMindspaceTexture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; texture: MindspaceTexture }) => {
      const db = getClientDataDb();
      await db.mindspaces.update(args.id, { texture: args.texture });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.mindspaces }),
  });
}
