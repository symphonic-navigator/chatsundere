// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useReducer, useState } from 'react';
import { copy } from '../../copy.js';
import type { AuditEventCategory } from '../../data/admin-api.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';

interface AuditFilter {
  category: AuditEventCategory | 'all';
  user_id: string;
  from: string;
  to: string;
  page: number;
}

const initial: AuditFilter = {
  category: 'all',
  user_id: '',
  from: '',
  to: '',
  page: 1,
};

type FilterAction =
  | { type: 'category'; value: AuditFilter['category'] }
  | { type: 'user_id'; value: string }
  | { type: 'from'; value: string }
  | { type: 'to'; value: string }
  | { type: 'page'; value: number };

function reduce(state: AuditFilter, action: FilterAction): AuditFilter {
  switch (action.type) {
    case 'category':
      return { ...state, category: action.value, page: 1 };
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

export function AuditScreen() {
  const [filter, dispatch] = useReducer(reduce, initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const api = getAdminApi();

  const { data } = useQuery({
    queryKey: ['audit', filter],
    queryFn: () =>
      api.listAudit({
        ...(filter.category !== 'all' ? { category: filter.category } : {}),
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
          value={filter.category}
          onChange={(e) =>
            dispatch({ type: 'category', value: e.target.value as AuditFilter['category'] })
          }
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="all">{copy.audit.categories.all}</option>
          <option value="auth">{copy.audit.categories.auth}</option>
          <option value="user-lifecycle">{copy.audit.categories['user-lifecycle']}</option>
          <option value="invitation-lifecycle">
            {copy.audit.categories['invitation-lifecycle']}
          </option>
          <option value="recovery">{copy.audit.categories.recovery}</option>
          <option value="admin-action">{copy.audit.categories['admin-action']}</option>
        </select>
        <input
          type="text"
          value={filter.user_id}
          onChange={(e) => dispatch({ type: 'user_id', value: e.target.value })}
          placeholder={copy.audit.filters.user}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
        <input
          type="date"
          aria-label={copy.audit.filters.from}
          value={filter.from}
          onChange={(e) => dispatch({ type: 'from', value: e.target.value })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
        <input
          type="date"
          aria-label={copy.audit.filters.to}
          value={filter.to}
          onChange={(e) => dispatch({ type: 'to', value: e.target.value })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
      </div>

      {!data ? (
        <p className="text-[var(--color-subtext-0)]">{copy.loading}</p>
      ) : data.items.length === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.audit.empty}</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase text-[var(--color-subtext-0)]">
              <th className="py-2">{copy.audit.columns.timestamp}</th>
              <th className="py-2">{copy.audit.columns.eventType}</th>
              <th className="py-2">{copy.audit.columns.actor}</th>
              <th className="py-2">{copy.audit.columns.subject}</th>
              <th className="py-2">{copy.audit.columns.metadata}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((e) => {
              const isExpanded = expanded.has(e.id);
              return (
                <tr key={e.id} className="border-t border-[var(--color-overlay-0)]">
                  <td className="py-2">{formatRelative(e.timestamp)}</td>
                  <td className="py-2 font-mono text-xs">{e.event_type}</td>
                  <td className="py-2">{e.actor_username ?? '—'}</td>
                  <td className="py-2">{e.subject_username ?? '—'}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      className="text-sm text-[var(--color-mauve)] underline"
                    >
                      {isExpanded ? copy.audit.collapse : copy.audit.expand}
                    </button>
                    {isExpanded && (
                      <pre className="mt-1 max-w-xs whitespace-pre-wrap break-words rounded-md bg-[var(--color-mantle)] p-2 text-xs">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
