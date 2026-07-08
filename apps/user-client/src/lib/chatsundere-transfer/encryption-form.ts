// SPDX-License-Identifier: AGPL-3.0-only

/** The encryption sub-form's state: whether encryption is on, plus the password and its confirmation. */
export interface EncryptFormState {
  enabled: boolean;
  password: string;
  confirm: string;
}

/** The default (off) state for an encryption form. */
export const INITIAL_ENCRYPT_FORM: EncryptFormState = { enabled: false, password: '', confirm: '' };

/** The resolved outcome of an encryption form: a usable password (or undefined when off), or a blocking reason. */
export type ResolvedExportPassword =
  | { ok: true; password: string | undefined }
  | { ok: false; reason: string };

/** Resolve an encryption form to a usable password (undefined when off) or a blocking reason. */
export function resolveExportPassword(state: EncryptFormState): ResolvedExportPassword {
  if (!state.enabled) return { ok: true, password: undefined };
  if (state.password.length === 0)
    return { ok: false, reason: 'Enter a password to encrypt with.' };
  if (state.password !== state.confirm)
    return { ok: false, reason: 'The two passwords do not match.' };
  return { ok: true, password: state.password };
}
