// SPDX-License-Identifier: MIT

export type {
  UserRole,
  ServerAuthMethodType,
  Invitation,
  InvitationQrPayload,
  JWTClaims,
  ErrorEnvelope,
  ErrorCode,
} from './auth.js';

export type {
  LinkPasskeyStartRequest,
  LinkPasskeyStartResponse,
  LinkPasskeyFinishRequest,
  LinkPasskeyFinishResponse,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from './linking.js';

export { JoinError } from './join.js';

export { opaqueServerIdentity } from './opaque-identity.js';

export type {
  JoinStartRequest,
  JoinStartResponse,
  JoinFinishRequest,
  JoinFinishResponse,
  JoinErrorCode,
} from './join.js';

export type {
  OpaqueLoginStartRequest,
  OpaqueLoginStartResponse,
  OpaqueLoginFinishRequest,
  OpaqueLoginFinishResponse,
  PasskeyLoginStartRequest,
  PasskeyLoginStartResponse,
  PasskeyLoginFinishRequest,
  PasskeyLoginFinishResponse,
} from './login.js';

export type {
  RecoveryStartRequest,
  RecoveryStartResponse,
  RecoveryFinishRequest,
  RecoveryFinishResponse,
} from './recovery.js';

export type {
  AdminUserSummary,
  AdminUserListResponse,
  AdminAuthMethodSummary,
  AdminUserDetail,
  AdminCreateInvitationRequest,
  AdminCreateInvitationResponse,
  AdminInvitationStatus,
  AdminInvitationSummary,
  AdminInvitationListResponse,
  AdminChangeRoleRequest,
  AdminTransferPrimaryRequest,
  AdminAuditLogEntry,
  AdminAuditLogResponse,
} from './admin.js';

export type {
  PassphraseChangeStartRequest,
  PassphraseChangeStartResponse,
  PassphraseChangeFinishRequest,
  PassphraseChangeFinishResponse,
} from './me.js';

export type { ServerConfig, KnownServerFeature } from './config.js';

export { SYNC_COLLECTIONS, revokedJtiKey, revokedSubKey } from './sync.js';
export type {
  SyncCollection,
  SyncPushRecord,
  SyncPulledRecord,
  SyncRecordErrorCode,
  SyncPushResult,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullResponse,
  DoorbellTicketResponse,
  DoorbellPoke,
  BlobRef,
  SyncBlobErrorCode,
  BlobListEntry,
  BlobListResponse,
  BlobErrorBody,
} from './sync.js';

export type {
  StepUpTier,
  StepUpMechanism,
  StepUpStartRequest,
  StepUpStartWebAuthnResponse,
  StepUpStartOpaqueResponse,
  StepUpStartResponse,
  StepUpFinishRequest,
  StepUpFinishResponse,
} from './step-up.js';
