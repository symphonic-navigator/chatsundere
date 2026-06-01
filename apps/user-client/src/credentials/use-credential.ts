// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { QK } from '../data/queryKeys.js';
import { hasCredential } from './credential-bus.js';
import type { CredentialId, CredentialPresence } from './types.js';

/**
 * Reactive credential-presence hook for integration UI. Returns presence only —
 * never the plaintext key (retrieval is an explicit MasterKey-gated call via
 * `getCredentialKey` at the point of need).
 *
 * The query key shares the `['providers']` prefix, so the invalidations in
 * `useUpsertProvider`/`useDeleteProvider` refetch it automatically when the
 * user adds or removes a key.
 */
export function useCredential(id: CredentialId): CredentialPresence {
  const query = useQuery({
    queryKey: QK.credential(id),
    queryFn: () => hasCredential(id),
  });
  return { present: query.data ?? false, isLoading: query.isLoading };
}
