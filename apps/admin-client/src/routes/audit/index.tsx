// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useReducer, useState } from 'react';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
import { Panel, SkeletonPanel, StatusLed } from '../../components/console.js';
import { copy } from '../../copy.js';
import { listAudit } from '../../data/api.js';
import type { AuditEventCategory } from '../../data/types.js';
import { formatRelative } from '../../lib/format.js';

interface AuditFilter {
  event_type: string; // '' = all
  user_id: string;
  from: string;
  to: string;
  page: number;
}

const initial: AuditFilter = {
  event_type: '',
  user_id: '',
  from: '',
  to: '',
  page: 1,
};

type FilterAction =
  | { type: 'event_type'; value: string }
  | { type: 'user_id'; value: string }
  | { type: 'from'; value: string }
  | { type: 'to'; value: string }
  | { type: 'page'; value: number };

function reduce(state: AuditFilter, action: FilterAction): AuditFilter {
  switch (action.type) {
    case 'event_type':
      return { ...state, event_type: action.value, page: 1 };
    case 'user_id':
      return { ...state, user_id: action.value, page: 1 };
    case 'from':
      return { ...state, from: action.value, page: 1 };
    case 'to':
      return { ...state, to: action.value, page: 1 };
    case 'page':
      return { ...state, page: action.value };
  }
}

const EVENT_TYPE_GROUPS: ReadonlyArray<{
  category: AuditEventCategory;
  types: readonly string[];
}> = [
  {
    category: 'auth',
    types: [
      'auth.login.success',
      'auth.login.failed',
      'auth.logout',
      'auth.step_up.confirmed',
      'auth.step_up.failed',
      'auth_method.added',
      'auth_method.removed',
      'auth_method.passphrase_changed',
    ],
  },
  {
    category: 'user-lifecycle',
    types: [
      'user.linked',
      'user.suspended',
      'user.unsuspended',
      'user.deleted_by_admin',
      'user.self_deleted',
      'user.role_changed',
      'user.username_changed',
    ],
  },
  {
    category: 'invitation-lifecycle',
    types: [
      'invitation.created',
      'invitation.revoked',
      'invitation.redeemed',
      'pairing_code.created',
      'pairing_code.revoked',
      'pairing_code.redeemed',
    ],
  },
  { category: 'recovery', types: ['recovery_used'] },
  {
    category: 'security',
    types: ['wrapping_invariant_violated', 'refresh_token.reuse_detected'],
  },
  { category: 'admin-action', types: ['primary_admin.transferred'] },
];

/** Deleted users keep their id in old entries; show it truncated and marked. */
function renderUser(username: string | null, id: string | null): string {
  if (username) return username;
  if (id) return `${id.slice(0, 8)}… (${copy.audit.deletedUser})`;
  return '—';
}

export function AuditScreen() {
  const [filter, dispatch] = useReducer(reduce, initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, error, refetch } = useQuery({
    queryKey: ['audit', filter],
    queryFn: () =>
      listAudit({
        ...(filter.event_type ? { event_type: filter.event_type } : {}),
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        page: filter.page,
      }),
    placeholderData: (prev) => prev,
  });

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-medium">{copy.audit.title}</h1>

      <div className="flex flex-wrap gap-2">
        <select
          value={filter.event_type}
          onChange={(e) => dispatch({ type: 'event_type', value: e.target.value })}
          className="rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-2 font-mono text-sm"
        >
          <option value="">{copy.audit.filters.allEvents}</option>
          {EVENT_TYPE_GROUPS.map((group) => (
            <optgroup key={group.category} label={copy.audit.categories[group.category]}>
              {group.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          type="text"
          value={filter.user_id}
          onChange={(e) => dispatch({ type: 'user_id', value: e.target.value })}
          placeholder={copy.audit.filters.user}
          className="rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-2 font-mono text-sm"
        />
        <input
          type="date"
          aria-label={copy.audit.filters.from}
          value={filter.from}
          onChange={(e) => dispatch({ type: 'from', value: e.target.value })}
          className="rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-2 font-mono text-sm"
        />
        <input
          type="date"
          aria-label={copy.audit.filters.to}
          value={filter.to}
          onChange={(e) => dispatch({ type: 'to', value: e.target.value })}
          className="rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-2 font-mono text-sm"
        />
      </div>

      {error ? (
        <QueryErrorPanel error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <SkeletonPanel lines={8} />
      ) : data.items.length === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.audit.empty}</p>
      ) : (
        <Panel
          led="yellow"
          scanlineHeader
          header={
            <span className="flex w-full items-center justify-between">
              {copy.audit.title}
              <span
                className="font-mono text-[10px] normal-case tracking-normal text-[var(--color-green)]"
                style={{ textShadow: '0 0 6px rgb(166 227 161 / 0.6)' }}
              >
                {'> tail --live ▎'}
              </span>
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-overlay-0)]">
                  <th className="py-2">{copy.audit.columns.timestamp}</th>
                  <th className="py-2">{copy.audit.columns.category}</th>
                  <th className="py-2">{copy.audit.columns.eventType}</th>
                  <th className="py-2">{copy.audit.columns.actor}</th>
                  <th className="py-2">{copy.audit.columns.subject}</th>
                  <th className="py-2">{copy.audit.columns.metadata}</th>
                </tr>
              </thead>
              <tbody className="font-mono text-sm">
                {data.items.map((e) => {
                  const isExpanded = expanded.has(e.id);
                  return (
                    <tr
                      key={e.id}
                      className="border-t border-[var(--color-surface-0)] hover:bg-[var(--color-crust)]"
                    >
                      <td className="py-2">{formatRelative(e.created_at)}</td>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          {e.category === 'security' && <StatusLed tone="red" />}
                          <span className="rounded-sm bg-[var(--color-crust)] px-2 py-0.5 font-mono text-xs">
                            {copy.audit.categories[e.category]}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs">{e.event_type}</td>
                      <td className="py-2">{renderUser(e.actor_username, e.actor_user_id)}</td>
                      <td className="py-2">{renderUser(e.user_username, e.user_id)}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => toggle(e.id)}
                          className="text-sm text-[var(--color-mauve)] underline"
                        >
                          {isExpanded ? copy.audit.collapse : copy.audit.expand}
                        </button>
                        {isExpanded && (
                          <pre className="mt-1 max-w-xs whitespace-pre-wrap break-words rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] p-2 text-xs">
                            {JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => dispatch({ type: 'page', value: Math.max(1, filter.page - 1) })}
          disabled={filter.page <= 1}
          className="rounded-md px-3 py-1 disabled:opacity-50"
        >
          {copy.users.pagePrev}
        </button>
        {data && (
          <span className="text-sm text-[var(--color-subtext-0)]">
            {data.page} / {Math.max(1, Math.ceil(data.total / data.per_page))}
          </span>
        )}
        <button
          type="button"
          onClick={() => dispatch({ type: 'page', value: filter.page + 1 })}
          disabled={!data || filter.page * data.per_page >= data.total}
          className="rounded-md px-3 py-1 disabled:opacity-50"
        >
          {copy.users.pageNext}
        </button>
      </div>
    </div>
  );
}
