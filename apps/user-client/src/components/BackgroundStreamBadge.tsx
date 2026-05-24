import { useQuery } from '@tanstack/react-query';
// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from 'react-router-dom';
import { getClientDataDb } from '../boot/client-data-db.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';

/**
 * Pill badge shown in the global topbar whenever one or more streams are
 * running in the background (i.e. the user has navigated away from a chat
 * that is still generating a response).
 *
 * - Zero streams → renders nothing.
 * - One stream → shows the persona's first initial; tapping navigates to that chat.
 * - Multiple streams → shows the count; tapping navigates to the oldest one.
 */
export function BackgroundStreamBadge(): JSX.Element | null {
  const navigate = useNavigate();
  const streams = useStreamManagerStore((s) => s.streams);

  const handles = [...streams.values()];
  const count = handles.length;

  // Find the oldest active stream (smallest startedAt) — O(n) single-pass.
  const oldest = count > 0 ? handles.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b)) : null;

  // Only fetch persona name when exactly one stream is live; multi-stream shows count.
  const personaQuery = useQuery({
    queryKey: ['persona', oldest?.personaId],
    enabled: count === 1 && !!oldest,
    queryFn: async () => {
      if (!oldest) return null;
      return (await getClientDataDb().personas.get(oldest.personaId)) ?? null;
    },
  });

  if (count === 0 || !oldest) return null;

  const label =
    count === 1 ? (personaQuery.data?.name?.charAt(0)?.toUpperCase() ?? '·') : String(count);

  const ariaLabel =
    count === 1
      ? `Return to active chat with ${personaQuery.data?.name ?? 'persona'}`
      : `${count} background streams`;

  return (
    <button
      type="button"
      className="bg-stream-badge"
      aria-label={ariaLabel}
      onClick={() => navigate(`/app/chat/${oldest.chatId}`)}
    >
      <span className="bg-stream-dot" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
