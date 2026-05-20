// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { copy } from '../../copy.js';
import { getAdminApi } from '../../data/index.js';
import { formatRelative } from '../../lib/format.js';
import { UserActions } from './actions.js';

export function UserDetailScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const api = getAdminApi();
  const { data } = useQuery({
    queryKey: ['user', id],
    queryFn: () => api.getUser(id),
    enabled: !!id,
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
      <aside className="space-y-4 rounded-md bg-[var(--color-mantle)] p-4">
        {!data ? (
          <p className="text-[var(--color-subtext-0)]">{copy.loading}</p>
        ) : (
          <>
            <div>
              <h2 className="text-2xl">{data.username}</h2>
              <p className="font-mono text-xs text-[var(--color-subtext-0)]">{data.id}</p>
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.role}</dt>
              <dd>{data.role}</dd>
              <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.status}</dt>
              <dd>{data.status}</dd>
              <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.createdAt}</dt>
              <dd>{formatRelative(data.created_at)}</dd>
              <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.lastLogin}</dt>
              <dd>{formatRelative(data.last_login_at)}</dd>
            </dl>
            <div>
              <h3 className="mb-1 text-sm uppercase text-[var(--color-subtext-0)]">
                {copy.userDetail.authMethods}
              </h3>
              <ul className="space-y-1 text-sm">
                {data.auth_methods.map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>
                      {m.label} ({m.type})
                    </span>
                    <span className="text-[var(--color-subtext-0)]">
                      {formatRelative(m.last_used_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <UserActions user={data} onDeleted={() => navigate('/users', { replace: true })} />
            <Link to="/users" className="block text-sm text-[var(--color-mauve)] underline">
              {copy.userDetail.backLink}
            </Link>
          </>
        )}
      </aside>
    </div>
  );
}
