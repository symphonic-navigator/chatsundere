// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient } from '@tanstack/react-query';

/**
 * Singleton TanStack Query client. Configured for an admin tool: short stale
 * time (data changes constantly), one retry, no refetch on focus (operators
 * tend to tab away and back).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
