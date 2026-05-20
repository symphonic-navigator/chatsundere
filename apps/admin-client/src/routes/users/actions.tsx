// SPDX-License-Identifier: AGPL-3.0-only
import { ConfirmTyped, useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { copy } from '../../copy.js';
import type { UserDetail } from '../../data/admin-api.js';
import { getAdminApi } from '../../data/index.js';
import { type Role, isPrimaryAdmin, isSelfTarget } from '../../lib/self-target.js';

interface Props {
  user: UserDetail;
  onDeleted: () => void;
}

export function UserActions({ user, onDeleted }: Props) {
  const session = useSessionStore((s) => s.session);
  const api = getAdminApi();
  const qc = useQueryClient();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Compute gating predicates exactly once so they are applied consistently
  // across all four action buttons. These are defence-in-depth (H5): the server
  // enforces the same rules authoritatively.
  const sessionLike = { userId: session?.userId ?? null };
  const sessionRole: Role = (session?.role ?? 'user') as Role;
  const isSelf = isSelfTarget(sessionLike, user.id);
  const sessionIsPrimary = isPrimaryAdmin(sessionRole);

  const suspend = useMutation({
    mutationFn: () => api.suspendUser(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id] }),
  });
  const unsuspend = useMutation({
    mutationFn: () => api.unsuspendUser(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteUser(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setConfirmDeleteOpen(false);
      onDeleted();
    },
  });
  const transfer = useMutation({
    mutationFn: () => api.transferPrimary(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', user.id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const selfTooltip = isSelf ? copy.userDetail.selfTargetTooltip : undefined;
  const primaryOnlyTooltip = sessionIsPrimary ? undefined : copy.userDetail.primaryOnlyTooltip;

  return (
    <div className="space-y-2">
      {user.status === 'active' ? (
        <ActionButton
          label={copy.userDetail.actions.suspend}
          disabled={isSelf || suspend.isPending}
          tooltip={selfTooltip}
          onClick={() => suspend.mutate()}
        />
      ) : (
        <ActionButton
          label={copy.userDetail.actions.unsuspend}
          disabled={isSelf || unsuspend.isPending}
          tooltip={selfTooltip}
          onClick={() => unsuspend.mutate()}
        />
      )}

      <ActionButton
        label={copy.userDetail.actions.changeRole}
        disabled={isSelf || !sessionIsPrimary}
        tooltip={selfTooltip ?? primaryOnlyTooltip}
        onClick={() => {
          // Role-change form lives inline in this panel in a later iteration;
          // server-side enforcement protects against unauthorised calls.
        }}
      />

      <ActionButton
        label={copy.userDetail.actions.transferPrimary}
        disabled={isSelf || !sessionIsPrimary || user.role !== 'admin' || transfer.isPending}
        tooltip={
          selfTooltip ??
          primaryOnlyTooltip ??
          (user.role !== 'admin' ? copy.userDetail.transferOnlyAdminTooltip : undefined)
        }
        onClick={() => transfer.mutate()}
      />

      <ActionButton
        label={copy.userDetail.actions.delete}
        disabled={isSelf || del.isPending}
        tooltip={selfTooltip}
        destructive
        onClick={() => setConfirmDeleteOpen(true)}
      />

      <ConfirmTyped
        open={confirmDeleteOpen}
        title={copy.userDetail.deleteConfirm.title}
        body={copy.userDetail.deleteConfirm.body}
        confirmToken={user.username}
        confirmTokenLabel={copy.userDetail.deleteConfirm.tokenLabel}
        destructiveCta={copy.userDetail.deleteConfirm.destructiveCta}
        cancelCta={copy.userDetail.deleteConfirm.cancelCta}
        busy={del.isPending}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

function ActionButton({
  label,
  disabled,
  tooltip,
  destructive,
  onClick,
}: {
  label: string;
  disabled: boolean;
  tooltip?: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  const base = destructive
    ? 'bg-[var(--color-red)] text-[var(--color-base)]'
    : 'bg-[var(--color-mantle)]';
  return (
    <button
      type="button"
      disabled={disabled}
      title={tooltip}
      onClick={onClick}
      className={`w-full rounded-md px-3 py-2 text-left ${base} disabled:opacity-50`}
    >
      {label}
      {tooltip && disabled && (
        <span className="ml-2 block text-xs text-[var(--color-subtext-0)]">{tooltip}</span>
      )}
    </button>
  );
}
