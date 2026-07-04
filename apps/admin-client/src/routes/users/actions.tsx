// SPDX-License-Identifier: AGPL-3.0-only
import { ConfirmTyped, useSessionStore } from '@chatsundere/ui-shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { copy } from '../../copy.js';
import {
  changeRole,
  deleteUser,
  suspendUser,
  transferPrimary,
  unsuspendUser,
} from '../../data/api.js';
import type { UserDetailView } from '../../data/types.js';
import { type Role, isPrimaryAdmin, isSelfTarget } from '../../lib/self-target.js';

interface Props {
  user: UserDetailView;
  onDeleted: () => void;
}

export function UserActions({ user, onDeleted }: Props) {
  const session = useSessionStore((s) => s.session);
  const qc = useQueryClient();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Compute gating predicates exactly once so they are applied consistently
  // across all four action buttons. These are defence-in-depth (H5): the server
  // enforces the same rules authoritatively.
  const sessionLike = { userId: session?.userId ?? null };
  // Defensive default: if a session reaches this component without a `role`
  // (e.g. an in-flight refresh between login and `/me`), treat it as `user`.
  // The route guard upstream ensures only admin/primary_admin sessions render
  // this UI in practice; this cast tightens the type for downstream uses.
  // See Larissa Squash C audit, finding S4.
  const sessionRole: Role = (session?.role ?? 'user') as Role;
  const isSelf = isSelfTarget(sessionLike, user.id);
  const sessionIsPrimary = isPrimaryAdmin(sessionRole);
  // True when this user is the only primary admin on the server. Delete
  // (and a future role-demotion) must be disabled — losing the only primary
  // admin leaves the server unmanageable. The operator has to call
  // `transferPrimary` first. Server-enforced; this is the client mirror.
  const isLastPrimary = user.is_last_primary_admin;

  const suspend = useMutation({
    mutationFn: () => suspendUser(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id] }),
  });
  const unsuspend = useMutation({
    mutationFn: () => unsuspendUser(user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id] }),
  });
  const del = useMutation({
    mutationFn: () => deleteUser(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setConfirmDeleteOpen(false);
      onDeleted();
    },
  });
  const transfer = useMutation({
    mutationFn: () => transferPrimary(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', user.id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const selfTooltip = isSelf ? copy.userDetail.selfTargetTooltip : undefined;
  const primaryOnlyTooltip = sessionIsPrimary ? undefined : copy.userDetail.primaryOnlyTooltip;
  const lastPrimaryTooltip = isLastPrimary ? copy.userDetail.lastPrimaryAdminTooltip : undefined;

  return (
    <div className="space-y-2">
      {user.status === 'active' ? (
        <ActionButton
          label={copy.userDetail.actions.suspend}
          disabled={isSelf || suspend.isPending}
          tooltip={selfTooltip}
          onClick={() => {
            // Defence-in-depth: re-check at click time even though disabled.
            // See Larissa Squash C audit, finding D2.
            if (isSelf || suspend.isPending) return;
            suspend.mutate();
          }}
        />
      ) : (
        <ActionButton
          label={copy.userDetail.actions.unsuspend}
          // Gating unsuspend with isSelf is deliberately symmetric to suspend.
          // The server enforces self-protection (audit H5); we keep the client
          // mirror strict for consistency rather than risk a UX where suspend
          // is blocked but unsuspend is not. See Larissa Squash C audit, S3.
          disabled={isSelf || unsuspend.isPending}
          tooltip={selfTooltip}
          onClick={() => {
            if (isSelf || unsuspend.isPending) return;
            unsuspend.mutate();
          }}
        />
      )}

      <RoleSection
        user={user}
        disabled={isSelf || isLastPrimary || !sessionIsPrimary}
        tooltip={
          selfTooltip ??
          lastPrimaryTooltip ??
          (sessionIsPrimary ? undefined : copy.userDetail.primaryOnlyTooltip)
        }
      />

      <ActionButton
        label={copy.userDetail.actions.transferPrimary}
        disabled={isSelf || !sessionIsPrimary || user.role !== 'admin' || transfer.isPending}
        tooltip={
          selfTooltip ??
          primaryOnlyTooltip ??
          (user.role !== 'admin' ? copy.userDetail.transferOnlyAdminTooltip : undefined)
        }
        onClick={() => {
          // Defence-in-depth: re-check all gating conditions.
          if (isSelf || !sessionIsPrimary || user.role !== 'admin' || transfer.isPending) return;
          transfer.mutate();
        }}
      />

      <ActionButton
        label={copy.userDetail.actions.delete}
        disabled={isSelf || isLastPrimary || del.isPending}
        tooltip={selfTooltip ?? lastPrimaryTooltip}
        destructive
        onClick={() => {
          // Defence-in-depth: do not open the confirm dialog at all for self
          // or for the last primary admin. Server enforces the same rules.
          if (isSelf || isLastPrimary || del.isPending) return;
          setConfirmDeleteOpen(true);
        }}
      />

      <ConfirmTyped
        // Re-evaluate gating predicates on every render: if the session or the
        // last-primary state changes while the dialog is open, it closes itself
        // by becoming open=false. See Larissa Squash C audit, finding D1.
        open={confirmDeleteOpen && !isSelf && !isLastPrimary}
        title={copy.userDetail.deleteConfirm.title}
        body={copy.userDetail.deleteConfirm.body}
        confirmToken={user.username}
        confirmTokenLabel={copy.userDetail.deleteConfirm.tokenLabel}
        destructiveCta={copy.userDetail.deleteConfirm.destructiveCta}
        cancelCta={copy.userDetail.deleteConfirm.cancelCta}
        busy={del.isPending}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          // D1 + D3: re-check all gating predicates and the pending state at
          // the moment of confirmation, in case state has shifted since open.
          if (isSelf || isLastPrimary || del.isPending) {
            setConfirmDeleteOpen(false);
            return;
          }
          del.mutate();
        }}
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

function RoleSection({
  user,
  disabled,
  tooltip,
}: {
  user: UserDetailView;
  disabled: boolean;
  tooltip?: string;
}) {
  const qc = useQueryClient();
  // primary_admin is not assignable via this endpoint; transfer-primary owns it.
  const [nextRole, setNextRole] = useState<'admin' | 'user'>(
    user.role === 'admin' ? 'user' : 'admin',
  );
  const mutation = useMutation({
    mutationFn: () => changeRole(user.id, nextRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', user.id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const blocked = disabled || mutation.isPending || nextRole === user.role;
  return (
    <div className="space-y-1">
      <label className="block text-sm">
        {copy.userDetail.actions.changeRole}
        <select
          value={nextRole}
          disabled={disabled}
          onChange={(e) => setNextRole(e.target.value === 'admin' ? 'admin' : 'user')}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2 disabled:opacity-50"
        >
          <option value="user">{copy.userDetail.roleOptions.user}</option>
          <option value="admin">{copy.userDetail.roleOptions.admin}</option>
        </select>
      </label>
      <button
        type="button"
        disabled={blocked}
        title={tooltip}
        onClick={() => {
          // Defence-in-depth (S1): re-check every gate at click time.
          if (blocked) return;
          mutation.mutate();
        }}
        className="w-full rounded-md bg-[var(--color-mantle)] px-3 py-2 text-left disabled:opacity-50"
      >
        {copy.userDetail.applyRole}
        {tooltip && disabled && (
          <span className="ml-2 block text-xs text-[var(--color-subtext-0)]">{tooltip}</span>
        )}
      </button>
      {mutation.isError && (
        <p className="text-xs text-[var(--color-red)]">{copy.userDetail.roleChangeFailed}</p>
      )}
    </div>
  );
}
