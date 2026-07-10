// SPDX-License-Identifier: LGPL-3.0-only

export const DB_NAME = 'chatsundere';
export const DB_VERSION = 2;

export const STORE_LOCAL_ACCOUNT = 'local_account';
export const STORE_LINKED_ACCOUNT = 'linked_account';
export const STORE_PASSKEY_CREDENTIALS = 'local_passkey_credentials';
export const STORE_STAGING = 'staging';
export const STORE_FLAGS = 'flags';

export interface LocalAccountRow {
  schema_version: number;
  username: string;
  local_salt: Uint8Array;
  wrapped_mk_local_ciphertext: Uint8Array;
  wrapped_mk_local_nonce: Uint8Array;
  wrapped_mk_local_aad: Uint8Array;
  wrapped_mk_local_integrity: Uint8Array;
  wrapped_mk_recovery_ciphertext: Uint8Array;
  wrapped_mk_recovery_nonce: Uint8Array;
  wrapped_mk_recovery_aad: Uint8Array;
  wrapped_mk_recovery_integrity: Uint8Array;
  recovery_verifier_key: Uint8Array;
  created_at: Date;
}

export interface LinkedAccountRow {
  server_user_id: string;
  base_url: string;
  issuer_label: string | null;
  role: 'primary_admin' | 'admin' | 'user';
  wrapped_mk_opaque_ciphertext: Uint8Array;
  wrapped_mk_opaque_nonce: Uint8Array;
  wrapped_mk_opaque_aad: Uint8Array;
  wrapped_mk_opaque_integrity: Uint8Array;
  linked_at: Date;
  /**
   * The username presented to the server at OPAQUE registration time (via
   * `linkToServer` / `recoveryOnline` / `recoverFromScratch`), frozen for the
   * lifetime of this link. OPAQUE bakes the client identifier into the
   * registration envelope, so every later OPAQUE ceremony (login, step-up,
   * pairing) must keep presenting this exact value — never the live
   * `local_account.username` — or the server's stored `opaque_client_identifier`
   * (auth-service migration 0005) desynchronises after a rename and every OPAQUE
   * round fails. Optional and unindexed: rows linked before this field existed
   * have it absent and self-heal it on their next successful OPAQUE ceremony
   * (see `login-online-linked.ts`, `step-up.ts`). No Dexie/IndexedDB version
   * bump needed for an optional, unindexed field.
   */
  opaque_client_identifier?: string;
}

export interface PasskeyCredentialRow {
  credential_id: Uint8Array;
  public_key: Uint8Array;
  sign_counter: number;
  aaguid: string | null;
  label: string;
  wrapped_mk_prf_ciphertext: Uint8Array;
  wrapped_mk_prf_nonce: Uint8Array;
  wrapped_mk_prf_aad: Uint8Array;
  wrapped_mk_prf_integrity: Uint8Array;
  is_synced_with_server: boolean;
  created_at: Date;
}

export type StagingState = 'pending' | 'committed' | 'rolled_back';

export interface StagingRow {
  key: 'pending_passphrase_change';
  new_local_salt: Uint8Array;
  new_wrapped_mk_local_ciphertext: Uint8Array;
  new_wrapped_mk_local_nonce: Uint8Array;
  new_wrapped_mk_local_aad: Uint8Array;
  new_wrapped_mk_local_integrity: Uint8Array;
  server_state: StagingState;
  created_at: Date;
}

/**
 * One-row key/value flags store. All persisted boolean feature flags go here.
 * The store is keyed by `key`; currently used for post-onboarding prompts.
 */
export interface FlagsRow {
  key: 'biometric_prompt';
  /** false = prompt due (not yet shown), true = prompt already dismissed/completed. */
  shown: boolean;
}
