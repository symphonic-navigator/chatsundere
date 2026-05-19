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
  LinkOpaqueStartRequest,
  LinkOpaqueStartResponse,
  LinkOpaqueFinishRequest,
  LinkOpaqueFinishResponse,
  LinkPasskeyStartRequest,
  LinkPasskeyStartResponse,
  LinkPasskeyFinishRequest,
  LinkPasskeyFinishResponse,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from './linking.js';

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
  AdminAuditLogEntry,
  AdminAuditLogResponse,
} from './admin.js';

export type {
  PassphraseChangeStartRequest,
  PassphraseChangeStartResponse,
  PassphraseChangeFinishRequest,
  PassphraseChangeFinishResponse,
} from './me.js';
