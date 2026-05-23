// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery } from '@tanstack/react-query';
import { getClientDataDb } from '../boot/client-data-db.js';
import { QK } from './queryKeys.js';

/** List all chat rows ordered by most-recently-active first. */
export function useChats() {
  return useQuery({
    queryKey: QK.chats,
    queryFn: async () => {
      const db = getClientDataDb();
      return await db.chats.orderBy('lastMessageAt').reverse().toArray();
    },
  });
}
