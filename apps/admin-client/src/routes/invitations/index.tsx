// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AdminCreateInvitationResponse,
  AdminInvitationStatus,
} from '@chatsundere/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
import { ConsoleChip, Panel, SkeletonPanel } from '../../components/console.js';
import { copy } from '../../copy.js';
import { listInvitations, revokeInvitation } from '../../data/api.js';
import { formatRelative } from '../../lib/format.js';
import { InvitationCreateModal } from './create-modal.js';
import { InvitationRevealScreen } from './reveal-screen.js';

interface InvitationsNavState {
  openCreate?: boolean;
}

export function InvitationsScreen() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<AdminInvitationStatus | 'all'>('all');
  // The Users-page "Create invitation" button navigates here with an
  // openCreate flag so the create flow opens directly instead of forcing a
  // second click. Read once, then consume the flag so a refresh does not
  // reopen the modal.
  const [modalOpen, setModalOpen] = useState(
    () => (location.state as InvitationsNavState | null)?.openCreate === true,
  );
  const [revealed, setRevealed] = useState<AdminCreateInvitationResponse | null>(null);

  useEffect(() => {
    if ((location.state as InvitationsNavState | null)?.openCreate) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const { data, error, refetch } = useQuery({
    queryKey: ['invitations', filter],
    queryFn: () => listInvitations({ status: filter }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-medium">{copy.invitations.title}</h1>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)]"
        >
          {copy.invitations.create}
        </button>
      </header>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as AdminInvitationStatus | 'all')}
        className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
      >
        <option value="all">{copy.invitations.filter.all}</option>
        <option value="pending">{copy.invitations.filter.pending}</option>
        <option value="redeemed">{copy.invitations.filter.redeemed}</option>
        <option value="expired">{copy.invitations.filter.expired}</option>
        <option value="revoked">{copy.invitations.filter.revoked}</option>
      </select>

      {error ? (
        <QueryErrorPanel error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <SkeletonPanel lines={6} />
      ) : data.items.length === 0 ? (
        <p className="text-[var(--color-subtext-0)]">{copy.invitations.empty}</p>
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-overlay-0)]">
                  <th className="py-2">{copy.invitations.columns.createdAt}</th>
                  <th className="py-2">{copy.invitations.columns.role}</th>
                  <th className="py-2">{copy.invitations.columns.suggestedUsername}</th>
                  <th className="py-2">{copy.invitations.columns.status}</th>
                  <th className="py-2">{copy.invitations.columns.redeemedBy}</th>
                  <th className="py-2">{copy.invitations.columns.expiresAt}</th>
                  <th className="py-2">{copy.invitations.columns.issuerLabel}</th>
                  <th className="py-2">{copy.invitations.columns.note}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="font-mono text-sm">
                {data.items.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-t border-[var(--color-surface-0)] hover:bg-[var(--color-crust)]"
                  >
                    <td className="py-2">{formatRelative(inv.created_at)}</td>
                    <td className="py-2">{inv.role}</td>
                    <td className="py-2">{inv.suggested_username ?? '—'}</td>
                    <td className="py-2">
                      <ConsoleChip tone={inv.status === 'pending' ? 'green' : 'neutral'}>
                        {inv.status}
                      </ConsoleChip>
                    </td>
                    <td className="py-2">{inv.redeemed_by_user_id ?? '—'}</td>
                    <td className="py-2">{formatRelative(inv.expires_at)}</td>
                    <td className="py-2 text-[var(--color-subtext-0)]">
                      {inv.issuer_label ?? '—'}
                    </td>
                    <td className="py-2">
                      {inv.note ? (
                        <span
                          title={inv.note}
                          className="cursor-help text-[var(--color-subtext-0)] underline decoration-dotted"
                        >
                          {copy.invitations.columns.noteHover}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {inv.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => revoke.mutate(inv.id)}
                          disabled={revoke.isPending}
                          className="rounded-md px-2 py-1 text-sm text-[var(--color-red)] disabled:opacity-50"
                        >
                          {copy.invitations.revoke}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {modalOpen && !revealed && (
        <InvitationCreateModal
          onCreated={(inv) => {
            setModalOpen(false);
            setRevealed(inv);
            qc.invalidateQueries({ queryKey: ['invitations'] });
          }}
          onCancel={() => setModalOpen(false)}
        />
      )}
      {revealed && (
        <InvitationRevealScreen invitation={revealed} onClose={() => setRevealed(null)} />
      )}
    </div>
  );
}
