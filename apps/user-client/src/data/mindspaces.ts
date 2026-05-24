// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery } from '@tanstack/react-query';
import { getClientDataDb } from '../boot/client-data-db.js';
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
