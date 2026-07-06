// SPDX-License-Identifier: LGPL-3.0-only

export {
  ALGO_VERSION,
  ARGON2ID_PARAMS,
  HKDF_HASH,
  WRAP_ALGO,
  asAmk,
  asDek,
  asIntegrityKey,
  asMasterKey,
  asRecoveryKey,
  asVerifierKey,
} from './types.js';
export type {
  AMK,
  DEK,
  IntegrityKey,
  MasterKey,
  RecoveryKey,
  VerifierKey,
  WrappedKey,
} from './types.js';
export { CryptoError } from './errors.js';
export type { CryptoErrorCode } from './errors.js';
export { assertRuntimeSupport } from './runtime.js';
export { constantTimeEqual } from './primitives/constant-time.js';
export { getRandomBytes } from './primitives/random.js';
export { hkdfSha256, argon2id } from './primitives/kdf.js';
export { makeLocalAccountAad } from './primitives/aad.js';
export type { Argon2idParams } from './primitives/kdf.js';
export { fromBase64Url, toBase64Url } from './encoding/base64url.js';
export { decodeRecoveryKey, encodeRecoveryKey } from './encoding/recovery-key.js';
export { aeadEncrypt, aeadDecrypt } from './primitives/aead.js';
export {
  deriveIntegrityKey,
  addIntegrityHmac,
  verifyIntegrityHmac,
} from './primitives/integrity.js';
export {
  deriveLocalAmk,
  deriveRecoveryAmk,
  deriveOpaqueAmk,
  derivePrfAmk,
} from './amk.js';
export {
  deriveVerifierKey,
  computeRecoveryProof,
  verifyRecoveryProof,
} from './recovery.js';
export { deriveDek } from './dek.js';
export { deriveIdentityTag, identityTagFromDek } from './identity-tag.js';
export {
  opaqueRegistrationStart,
  opaqueRegistrationFinish,
  opaqueLoginStart,
  opaqueLoginFinish,
} from './opaque/client.js';
export type {
  RegistrationStartResult,
  RegistrationFinishArgs,
  RegistrationFinishResult,
  LoginStartResult,
  LoginFinishArgs,
  LoginFinishResult,
} from './opaque/client.js';
export { PRF_INPUT_SALT, credentialIdPrefix } from './webauthn/prf.js';
export { isSyncedAuthenticator, SYNCED_PASSKEY_AAGUIDS } from './webauthn/aaguid-allowlist.js';
export { verifyLocalAssertion, generateLocalChallenge } from './webauthn/local-verify.js';
export type { LocalAssertionArgs, LocalAssertionResult } from './webauthn/local-verify.js';
export {
  DB_NAME,
  DB_VERSION,
  STORE_FLAGS,
  STORE_LOCAL_ACCOUNT,
  STORE_LINKED_ACCOUNT,
  STORE_PASSKEY_CREDENTIALS,
  STORE_STAGING,
} from './db/schema.js';
export type {
  FlagsRow,
  LocalAccountRow,
  LinkedAccountRow,
  PasskeyCredentialRow,
  StagingRow,
  StagingState,
} from './db/schema.js';
export { openLocalDb } from './db/open.js';
export {
  getBiometricPromptShown,
  setBiometricPromptDue,
  setBiometricPromptShown,
} from './db/flags.js';
export {
  getLocalAccount,
  putLocalAccount,
  deleteLocalAccount,
  requireLocalAccount,
} from './db/local-account.js';
export {
  getLinkedAccount,
  putLinkedAccount,
  deleteLinkedAccount,
} from './db/linked-account.js';
export { putLocalAndLinkedAccount } from './db/account-pair.js';
export {
  listPasskeyCredentials,
  getPasskeyCredential,
  putPasskeyCredential,
  deletePasskeyCredential,
} from './db/passkey-credentials.js';
export {
  getStaging,
  putStaging,
  deleteStaging,
  setStagingState,
} from './db/staging.js';
export { createMasterKeySession } from './session.js';
export type {
  MasterKeySession,
  MasterKeySessionInit,
  RegisterLocalBiometricArgs,
} from './session.js';
export { createLocalAccount, validateUsername } from './flows/create-local-account.js';
export type {
  CreateLocalAccountArgs,
  CreateLocalAccountResult,
} from './flows/create-local-account.js';
export {
  loginLocalWithPassphrase,
  loginLocalWithRecoveryKey,
  listLocalBiometric,
} from './flows/login-local.js';
export type {
  LoginLocalWithPassphraseArgs,
  LoginLocalWithRecoveryKeyArgs,
  LoginLocalResult,
} from './flows/login-local.js';
export { completeLocalBiometricRegistration } from './flows/setup-biometric.js';
export type { CompleteLocalBiometricRegistrationArgs } from './flows/setup-biometric.js';
export { loginWithLocalBiometric } from './flows/login-biometric.js';
export type { LoginWithLocalBiometricArgs } from './flows/login-biometric.js';
export {
  changePassphraseLocalOnly,
  changePassphraseLinkedOnline,
  reconcileStagingOnBoot,
} from './flows/change-passphrase.js';
export type { ChangePassphraseArgs } from './flows/change-passphrase.js';
export { regenerateRecoveryKey } from './flows/regenerate-recovery-key.js';
export type { RegenerateRecoveryKeyArgs } from './flows/regenerate-recovery-key.js';
export { changeUsername } from './flows/change-username.js';
export type { ChangeUsernameArgs } from './flows/change-username.js';
export { startJoinByInvitation, finishJoinByInvitation } from './flows/join-by-invitation.js';
export type {
  StartJoinByInvitationArgs,
  JoinByInvitationState,
  FinishJoinByInvitationArgs,
  FinishJoinByInvitationResult,
} from './flows/join-by-invitation.js';
export { startJoinByPairing, finishJoinByPairing } from './flows/join-by-pairing.js';
export type {
  StartJoinByPairingArgs,
  JoinByPairingState,
  FinishJoinByPairingArgs,
  FinishJoinByPairingResult,
} from './flows/join-by-pairing.js';
export { linkToServer } from './flows/link-to-server.js';
export type { LinkToServerArgs } from './flows/link-to-server.js';
export { loginOnlineLinked } from './flows/login-online-linked.js';
export type {
  LoginOnlineLinkedArgs,
  LoginOnlineLinkedResult,
  ServerOutcome,
} from './flows/login-online-linked.js';
export { recoveryOnline } from './flows/recovery-online.js';
export type { RecoveryOnlineArgs } from './flows/recovery-online.js';
export { recoverFromScratch } from './flows/recover-from-scratch.js';
export type {
  RecoverFromScratchArgs,
  RecoverFromScratchResult,
} from './flows/recover-from-scratch.js';
export { deleteServerAccount } from './flows/server-account-delete.js';
export type { DeleteServerAccountArgs } from './flows/server-account-delete.js';
export { addPasskeyPostLink } from './flows/add-passkey-post-link.js';
export type { AddPasskeyPostLinkArgs } from './flows/add-passkey-post-link.js';
export {
  stepUpWithPasskey,
  stepUpWithPassphrase,
  type PasskeyStepUpOutcome,
  type PassphraseStepUpOutcome,
  type StepUpWithPasskeyArgs,
  type StepUpWithPassphraseArgs,
} from './flows/step-up.js';
export type { ServerClient } from './server-client.js';
export {
  computeBlindId,
  decodeRow,
  encodeRow,
  padPlaintext,
  unpadPlaintext,
  PADDED_COLLECTIONS,
  openRecord,
  sealRecord,
} from './sync-envelope/index.js';
export type { SealedRecord } from './sync-envelope/index.js';
export { BLOB_AAD_PREFIX, mintBlobId, openBlob, sealBlob } from './sync-blob/index.js';
