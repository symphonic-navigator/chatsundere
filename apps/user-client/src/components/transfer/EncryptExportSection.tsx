// SPDX-License-Identifier: AGPL-3.0-only
import { useId } from 'react';
import type { EncryptFormState } from '../../lib/chatsundere-transfer/encryption-form.js';

/** Props for EncryptExportSection: the controlled form state and its change handler. */
export interface EncryptExportSectionProps {
  state: EncryptFormState;
  onChange: (next: EncryptFormState) => void;
}

/**
 * Optional password-encryption controls for an export. Off by default; ticking
 * the box reveals a password + confirmation field and a plain no-recovery note.
 */
export function EncryptExportSection({ state, onChange }: EncryptExportSectionProps): JSX.Element {
  const checkboxId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <label htmlFor={checkboxId} className="cursor-pointer text-sm text-paper">
            Encrypt with a password
          </label>
          <p className="text-[11px] text-paper-soft">Off: the file is not password-protected.</p>
        </div>
        <input
          id={checkboxId}
          type="checkbox"
          checked={state.enabled}
          onChange={(e) =>
            onChange({ ...state, enabled: e.target.checked, password: '', confirm: '' })
          }
          className="mt-0.5 shrink-0 accent-paper"
        />
      </div>
      {state.enabled ? (
        <div className="flex flex-col gap-2">
          <input
            aria-label="Password"
            type="password"
            autoComplete="new-password"
            value={state.password}
            onChange={(e) => onChange({ ...state, password: e.target.value })}
            placeholder="Password"
            className="rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 text-sm text-paper"
          />
          <input
            aria-label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={state.confirm}
            onChange={(e) => onChange({ ...state, confirm: e.target.value })}
            placeholder="Confirm password"
            className="rounded-md border border-paper-soft/30 bg-transparent px-3 py-1.5 text-sm text-paper"
          />
          <p className="text-[11px] text-amber-300/80">
            If you lose this password, the file cannot be opened — there is no recovery.
          </p>
        </div>
      ) : null}
    </div>
  );
}
