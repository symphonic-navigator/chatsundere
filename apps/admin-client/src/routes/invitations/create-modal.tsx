// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { copy } from '../../copy.js';
import type { CreateInvitationInput, InvitationCreated } from '../../data/admin-api.js';
import { getAdminApi } from '../../data/index.js';

interface Props {
  onCreated: (inv: InvitationCreated) => void;
  onCancel: () => void;
}

export function InvitationCreateModal({ onCreated, onCancel }: Props) {
  const [role, setRole] = useState<CreateInvitationInput['role']>('user');
  const [expiresIn, setExpiresIn] = useState<1 | 7 | 30>(7);
  const [issuerLabel, setIssuerLabel] = useState('');
  const api = getAdminApi();

  const create = useMutation({
    mutationFn: (input: CreateInvitationInput) => api.createInvitation(input),
    onSuccess: onCreated,
  });

  const submit = () => {
    const input: CreateInvitationInput = {
      role,
      expires_in_days: expiresIn,
      ...(issuerLabel ? { issuer_label: issuerLabel } : {}),
    };
    create.mutate(input);
  };

  return (
    <dialog
      open
      aria-labelledby="create-invitation-title"
      className="space-y-4 rounded-md bg-[var(--color-mantle)] p-6"
    >
      <h2 id="create-invitation-title" className="text-2xl">
        {copy.invitations.modal.title}
      </h2>
      <label className="block text-sm">
        {copy.invitations.modal.role}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as CreateInvitationInput['role'])}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        >
          <option value="user">{copy.invitations.modal.roleOptions.user}</option>
          <option value="admin">{copy.invitations.modal.roleOptions.admin}</option>
        </select>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.expiresIn}
        <select
          value={expiresIn}
          onChange={(e) => setExpiresIn(Number(e.target.value) as 1 | 7 | 30)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        >
          <option value={1}>{copy.invitations.modal.expiresOptions.day}</option>
          <option value={7}>{copy.invitations.modal.expiresOptions.week}</option>
          <option value={30}>{copy.invitations.modal.expiresOptions.month}</option>
        </select>
      </label>
      <label className="block text-sm">
        {copy.invitations.modal.issuerLabel}
        <input
          value={issuerLabel}
          onChange={(e) => setIssuerLabel(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1">
          {copy.invitations.modal.cancel}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)] disabled:opacity-50"
        >
          {copy.invitations.modal.submit}
        </button>
      </div>
    </dialog>
  );
}
