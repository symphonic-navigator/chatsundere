// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type SettingsRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** Read the singleton settings row (id = 1). Throws if the seed has not run. */
export function useSettings() {
  return useQuery({
    queryKey: QK.settings,
    queryFn: async () => {
      const db = getClientDataDb();
      const row = await db.settings.get(1);
      if (!row) throw new Error('settings singleton missing — seed should have run');
      return row;
    },
  });
}

/** Partially update the settings singleton and invalidate the query on success. */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<SettingsRow, 'id' | 'createdAt'>>) => {
      const db = getClientDataDb();
      const now = Date.now();
      await db.settings.update(1, { ...patch, updatedAt: now });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.settings }),
  });
}

/**
 * Resolved display-name for the current user.
 *
 * Priority chain:
 *   1. settings.displayName.trim() if non-empty
 *   2. session.username
 *   3. '—' (em-dash placeholder while the session is null)
 */
export function useDisplayName(): string {
  const settings = useSettings();
  const session = useSessionStore((s) => s.session);
  const trimmed = settings.data?.displayName?.trim();
  if (trimmed) return trimmed;
  return session?.username ?? '—';
}
