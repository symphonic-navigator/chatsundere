// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type SettingsRow, getClientDataDb } from '../boot/client-data-db.js';
import { mutateSynced } from '../sync/enqueue.js';
import { patchTouchesSyncedField } from '../sync/strip.js';
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
      const now = Date.now();
      // Field-split (spec §5/§10): the settings row is whole-row Class 2, but its
      // device-local fields (`adultMode`, `corsProxy`, the per-device render
      // toggles) are NOT in the sync allowlist and must stay editable offline. A
      // patch touching only device-local fields is a plain local write; any
      // allowlisted field makes it a gated Class-2 mutation. The sync key is the
      // literal '1' (§3.1).
      if (!patchTouchesSyncedField('settings', Object.keys(patch))) {
        await getClientDataDb().settings.update(1, { ...patch, updatedAt: now });
        return;
      }
      await mutateSynced({
        collection: 'settings',
        key: '1',
        tables: ['settings'],
        write: async (tx) => {
          await tx.table('settings').update(1, { ...patch, updatedAt: now });
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.settings }),
  });
}

/**
 * Resolved display-name for the current user.
 *
 * Priority chain:
 *   1. settings.displayName.trim() if non-empty
 *   2. fallback parameter (e.g. a username known to a pre-session screen)
 *   3. session.username (when logged in)
 *   4. '—' (em-dash placeholder)
 */
export function useDisplayName(fallback?: string | null): string {
  const settings = useSettings();
  const session = useSessionStore((s) => s.session);
  const trimmed = settings.data?.displayName?.trim();
  if (trimmed) return trimmed;
  if (fallback) return fallback;
  return session?.username ?? '—';
}

/**
 * Adult-mode toggle for filtering personas (and future surfaces). The mode
 * is **device-local**: when sync lands in a future phase, this field must
 * be in the sync-exclusion list. Default is 'nsfw' (per spec §2 Decision 2
 * — SFW is treated as the special case, not the default).
 */
export function useAdultMode(): {
  mode: 'nsfw' | 'sfw';
  toggleMode: () => Promise<void>;
  setMode: (m: 'nsfw' | 'sfw') => Promise<void>;
} {
  const settings = useSettings();
  const update = useUpdateSettings();
  const mode = settings.data?.adultMode ?? 'nsfw';
  return {
    mode,
    toggleMode: () =>
      update.mutateAsync({ adultMode: mode === 'nsfw' ? 'sfw' : 'nsfw' }).then(() => undefined),
    setMode: (m) => update.mutateAsync({ adultMode: m }).then(() => undefined),
  };
}
