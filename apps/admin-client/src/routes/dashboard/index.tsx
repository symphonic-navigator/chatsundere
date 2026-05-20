// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';

export function DashboardScreen() {
  const api = getAdminApi();
  const { data } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.getDashboardSummary(),
  });

  if (!data) {
    return <p className="text-[var(--color-subtext-0)]">{copy.loading}</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-medium">{copy.dashboard.title}</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card label={copy.dashboard.cards.totalUsers} value={data.total_users} />
        <Card label={copy.dashboard.cards.pendingInvitations} value={data.pending_invitations} />
        <Card label={copy.dashboard.cards.suspendedUsers} value={data.suspended_users} />
      </div>
      <section>
        <h2 className="mb-2 text-xl">{copy.dashboard.recentActivity}</h2>
        {data.recent_activity.length === 0 ? (
          <p className="text-[var(--color-subtext-0)]">{copy.dashboard.noActivity}</p>
        ) : (
          <ul className="space-y-2">
            {data.recent_activity.map((e) => (
              <li key={e.id} className="rounded-md bg-[var(--color-mantle)] px-4 py-2">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-mono">{e.event_type}</span>
                  <span className="text-[var(--color-subtext-0)]">
                    {formatRelative(e.timestamp)}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-subtext-0)]">
                  {e.actor_username ?? '—'}
                  {e.subject_username ? ` → ${e.subject_username}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link to="/users" className="text-[var(--color-mauve)] underline">
        {copy.dashboard.viewUsers}
      </Link>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-[var(--color-mantle)] p-4">
      <div className="text-sm text-[var(--color-subtext-0)]">{label}</div>
      <div className="text-3xl">{value}</div>
    </div>
  );
}
