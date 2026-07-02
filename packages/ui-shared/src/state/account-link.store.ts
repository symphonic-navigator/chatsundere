// SPDX-License-Identifier: LGPL-3.0-only
import { type LinkedAccountRow, getLinkedAccount } from '@chatsundere/crypto';
import { create } from 'zustand';

export type LinkStatus = 'unknown' | 'local-only' | 'linked';

interface AccountLinkState {
  linkStatus: LinkStatus;
  baseUrl: string | null;
  issuerLabel: string | null;
  role: 'primary_admin' | 'admin' | 'user' | null;
  setLinked(row: Pick<LinkedAccountRow, 'base_url' | 'issuer_label' | 'role'>): void;
  setLocalOnly(): void;
}

/**
 * Central "does a linked account exist" gate (spec §6). Initial state is
 * 'unknown' so gates never briefly claim enabled before the boot-time IDB
 * read resolves. Existing per-screen getLinkedAccount reads migrate onto
 * this store organically in later workstreams.
 */
export const useAccountLinkStore = create<AccountLinkState>((set) => ({
  linkStatus: 'unknown',
  baseUrl: null,
  issuerLabel: null,
  role: null,
  setLinked: (row) =>
    set({
      linkStatus: 'linked',
      baseUrl: row.base_url,
      issuerLabel: row.issuer_label,
      role: row.role,
    }),
  setLocalOnly: () =>
    set({ linkStatus: 'local-only', baseUrl: null, issuerLabel: null, role: null }),
}));

/** Boot-time population from the crypto IDB (read-only accessor use). */
export async function initAccountLinkFromDb(db: IDBDatabase): Promise<void> {
  const row = await getLinkedAccount(db);
  if (row) useAccountLinkStore.getState().setLinked(row);
  else useAccountLinkStore.getState().setLocalOnly();
}
