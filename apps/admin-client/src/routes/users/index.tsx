// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useReducer } from 'react';
import { Link } from 'react-router-dom';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
import { ConsoleChip, Panel, SkeletonPanel } from '../../components/console.js';
import { copy } from '../../copy.js';
import { listUsers } from '../../data/api.js';
import type { UserStatus } from '../../data/types.js';
import { formatRelative } from '../../lib/format.js';
import type { Role } from '../../lib/self-target.js';

export interface ListFilter {
  search: string;
  role: Role | 'all';
  status: UserStatus | 'all';
  page: number;
}

export const initialListFilter: ListFilter = {
  search: '',
  role: 'all',
  status: 'all',
  page: 1,
};

export type ListFilterAction =
  | { type: 'search'; value: string }
  | { type: 'role'; value: Role | 'all' }
  | { type: 'status'; value: UserStatus | 'all' }
  | { type: 'page'; value: number };

/** Pure reducer for the users list filter and pagination state. */
export function reduceListFilter(state: ListFilter, action: ListFilterAction): ListFilter {
  switch (action.type) {
    case 'search':
      return { ...state, search: action.value, page: 1 };
    case 'role':
      return { ...state, role: action.value, page: 1 };
    case 'status':
      return { ...state, status: action.value, page: 1 };
    case 'page':
      return { ...state, page: action.value };
  }
}

export function UsersListScreen() {
  const [filter, dispatch] = useReducer(reduceListFilter, initialListFilter);
  const { data, error, refetch } = useQuery({
    queryKey: ['users', filter],
    queryFn: () => listUsers(filter),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-medium">{copy.users.title}</h1>
        <Link
          to="/invitations"
          className="rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)]"
        >
          {copy.users.createInvitation}
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={filter.search}
          onChange={(e) => dispatch({ type: 'search', value: e.target.value })}
          placeholder={copy.users.searchPlaceholder}
          className="flex-1 rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        />
        <select
          value={filter.role}
          onChange={(e) => dispatch({ type: 'role', value: e.target.value as ListFilter['role'] })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="all">{copy.users.roleFilter.all}</option>
          <option value="primary_admin">{copy.users.roleFilter.primary_admin}</option>
          <option value="admin">{copy.users.roleFilter.admin}</option>
          <option value="user">{copy.users.roleFilter.user}</option>
        </select>
        <select
          value={filter.status}
          onChange={(e) =>
            dispatch({ type: 'status', value: e.target.value as ListFilter['status'] })
          }
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="all">{copy.users.statusFilter.all}</option>
          <option value="active">{copy.users.statusFilter.active}</option>
          <option value="suspended">{copy.users.statusFilter.suspended}</option>
        </select>
      </div>

      {error ? (
        <QueryErrorPanel error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <SkeletonPanel lines={6} />
      ) : data.items.length === 0 && data.total === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.users.empty}</p>
      ) : (
        <>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-overlay-0)]">
                    <th className="py-2">{copy.users.columns.username}</th>
                    <th className="py-2">{copy.users.columns.role}</th>
                    <th className="py-2">{copy.users.columns.status}</th>
                    <th className="py-2">{copy.users.columns.createdAt}</th>
                    <th className="py-2">{copy.users.columns.lastLogin}</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-sm">
                  {data.items.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t border-[var(--color-surface-0)] hover:bg-[var(--color-crust)]"
                    >
                      <td className="py-2">
                        <Link to={`/users/${u.id}`} className="text-[var(--color-mauve)] underline">
                          {u.username}
                        </Link>
                      </td>
                      <td className="py-2">{u.role}</td>
                      <td className="py-2">
                        <ConsoleChip tone={u.status === 'active' ? 'green' : 'neutral'}>
                          {u.status}
                        </ConsoleChip>
                      </td>
                      <td className="py-2">{formatRelative(u.created_at)}</td>
                      <td className="py-2">{formatRelative(u.last_login_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => dispatch({ type: 'page', value: Math.max(1, filter.page - 1) })}
              disabled={filter.page <= 1}
              className="rounded-md px-3 py-1 disabled:opacity-50"
            >
              {copy.users.pagePrev}
            </button>
            <span className="text-sm text-[var(--color-subtext-0)]">
              {data.page} / {Math.max(1, Math.ceil(data.total / data.per_page))}
            </span>
            <button
              type="button"
              onClick={() => dispatch({ type: 'page', value: filter.page + 1 })}
              disabled={filter.page * data.per_page >= data.total}
              className="rounded-md px-3 py-1 disabled:opacity-50"
            >
              {copy.users.pageNext}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
