// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
import {
  type LedTone,
  Panel,
  SkeletonPanel,
  StatTile,
  StatusLed,
} from '../../components/console.js';
import { copy } from '../../copy.js';
import { getDashboardSummary } from '../../data/api.js';
import type { AuditRow } from '../../data/types.js';
import { formatRelative } from '../../lib/format.js';

/** LED tone for an activity row: red on security events, yellow on step-up. */
function rowTone(e: AuditRow): LedTone {
  if (e.category === 'security' || e.event_type === 'auth.login.failed') return 'red';
  if (e.event_type.startsWith('auth.step_up.')) return 'yellow';
  return 'green';
}

export function DashboardScreen() {
  const { data, error, refetch } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => getDashboardSummary(),
  });

  if (error) {
    return <QueryErrorPanel error={error} onRetry={() => void refetch()} />;
  }

  if (!data) {
    return <SkeletonPanel lines={5} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-medium">{copy.dashboard.title}</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatTile
          index="01"
          accent="mauve"
          label={copy.dashboard.cards.totalUsers}
          value={data.total_users}
          subline={
            data.suspended_users > 0
              ? copy.dashboard.cards.suspendedSubline(data.suspended_users)
              : copy.dashboard.cards.allActive
          }
        />
        <StatTile
          index="02"
          accent="peach"
          label={copy.dashboard.cards.pendingInvitations}
          value={data.pending_invitations}
          subline={
            data.soonest_pending_expiry
              ? copy.dashboard.cards.expirySubline(formatRelative(data.soonest_pending_expiry))
              : copy.dashboard.cards.nonePending
          }
        />
        <StatTile
          index="03"
          accent="teal"
          label={copy.dashboard.cards.events24h}
          value={data.events_24h}
          subline={copy.dashboard.cards.events24hSubline}
        />
      </div>
      <Panel
        led="yellow"
        scanlineHeader
        header={
          <span className="flex w-full items-center justify-between">
            {copy.dashboard.recentActivity}
            <span
              className="font-mono text-[10px] normal-case tracking-normal text-[var(--color-green)]"
              style={{ textShadow: '0 0 6px rgb(166 227 161 / 0.6)' }}
            >
              {'> tail --live ▎'}
            </span>
          </span>
        }
      >
        {data.recent_activity.length === 0 ? (
          <p className="text-[var(--color-subtext-0)]">{copy.dashboard.noActivity}</p>
        ) : (
          <ul className="space-y-2">
            {data.recent_activity.map((e) => (
              <li key={e.id} className="rounded-md bg-[var(--color-crust)] px-4 py-2 font-mono">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <StatusLed tone={rowTone(e)} />
                    {e.event_type}
                  </span>
                  <span className="text-[var(--color-subtext-0)]">
                    {formatRelative(e.created_at)}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-subtext-0)]">
                  {e.actor_username ?? '—'}
                  {e.user_username ? ` → ${e.user_username}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Link to="/users" className="text-[var(--color-mauve)] underline">
        {copy.dashboard.viewUsers}
      </Link>
    </div>
  );
}
