// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
import { Panel, SkeletonPanel } from '../../components/console.js';
import { copy } from '../../copy.js';
import { getUser } from '../../data/api.js';
import { formatRelative } from '../../lib/format.js';
import { UserActions } from './actions.js';

export function UserDetailScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, error, refetch } = useQuery({
    queryKey: ['user', id],
    queryFn: () => getUser(id),
    enabled: !!id,
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
      {error ? (
        <QueryErrorPanel error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <SkeletonPanel lines={6} />
      ) : (
        <>
          <Panel header={copy.userDetail.profile}>
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl">{data.username}</h2>
                <p className="font-mono text-xs text-[var(--color-subtext-0)]">{data.id}</p>
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.role}</dt>
                <dd className="font-mono">{data.role}</dd>
                <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.status}</dt>
                <dd className="font-mono">{data.status}</dd>
                <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.createdAt}</dt>
                <dd className="font-mono">{formatRelative(data.created_at)}</dd>
                <dt className="text-[var(--color-subtext-0)]">{copy.userDetail.lastLogin}</dt>
                <dd className="font-mono">{formatRelative(data.last_login_at)}</dd>
              </dl>
              <Link to="/users" className="block text-sm text-[var(--color-mauve)] underline">
                {copy.userDetail.backLink}
              </Link>
            </div>
          </Panel>
          <div className="space-y-6">
            <Panel header={copy.userDetail.authMethods}>
              <ul className="space-y-1 text-sm">
                {data.auth_methods.map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>
                      {m.label ?? copy.userDetail.unnamedMethod} (
                      {m.method_type === 'passkey'
                        ? copy.userDetail.methodPasskey
                        : copy.userDetail.methodPassphrase}
                      )
                    </span>
                    <span className="text-[var(--color-subtext-0)]">
                      {formatRelative(m.last_used_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel header={copy.userDetail.actionsHeader} led="yellow">
              <UserActions user={data} onDeleted={() => navigate('/users', { replace: true })} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
