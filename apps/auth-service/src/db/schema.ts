// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// citext for usernames — case-insensitive equality with original case preserved.
// The extension is installed by the migration; this customType maps it.
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

// bytea for fixed-shape binary fields (wrapped MK, nonces, keys, hashes).
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const userRole = pgEnum('user_role', ['primary_admin', 'admin', 'user']);
export const authMethodType = pgEnum('auth_method_type', ['opaque', 'passkey']);
export const invitationRole = pgEnum('invitation_role', ['primary_admin', 'admin', 'user']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    username: citext('username').notNull().unique(),
    role: userRole('role').notNull().default('user'),
    recoveryVerifierKey: bytea('recovery_verifier_key').notNull(),
    /** Client-side wrapped master key encrypted under the recovery key. Added by migration 0002. */
    wrappedMkRecovery: bytea('wrapped_mk_recovery'),
    /** Nonce for the recovery-wrapped master key. Added by migration 0002. */
    wrapNonceRecovery: bytea('wrap_nonce_recovery'),
    /** AAD for the recovery-wrapped master key. Added by migration 0002. */
    wrapAadRecovery: bytea('wrap_aad_recovery'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => ({
    onePrimaryAdmin: uniqueIndex('users_one_primary_admin')
      .on(t.role)
      .where(sql`${t.role} = 'primary_admin'`),
  }),
);

export const authMethods = pgTable(
  'auth_methods',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    methodType: authMethodType('method_type').notNull(),
    label: text('label'),
    opaqueCredential: bytea('opaque_credential'),
    passkeyCredentialId: bytea('passkey_credential_id'),
    passkeyPublicKey: bytea('passkey_public_key'),
    passkeySignCount: bigint('passkey_sign_count', { mode: 'number' }),
    passkeyAaguid: uuid('passkey_aaguid'),
    passkeyTransports: jsonb('passkey_transports'),
    wrappedMasterKey: bytea('wrapped_master_key').notNull(),
    wrapNonce: bytea('wrap_nonce').notNull(),
    wrapAlgo: text('wrap_algo').notNull().default('AES-256-GCM'),
    wrapAad: bytea('wrap_aad').notNull(),
    // Stores the OPAQUE userIdentifier used at registration (invitation.id).
    // Login must present the same identifier for OPAQUE credential verification to succeed.
    opaqueUserIdentifier: text('opaque_user_identifier'),
    // Stores the OPAQUE client identifier (username at registration time) so
    // login and step-up keep working after a PATCH /api/v1/me username
    // change. The OPAQUE registration record is sealed against this value;
    // reading it from the live users.username would lock renamed users out
    // of OPAQUE entirely. See migration 0005 for the backfill rationale.
    opaqueClientIdentifier: text('opaque_client_identifier'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    // Plain (non-unique) index retained for lookup performance: passkey
    // queries filter by (user_id, method_type = 'passkey') and a user may
    // legitimately hold many passkey rows (one per registered authenticator),
    // so the partial unique index below — scoped to 'opaque' only — cannot
    // serve those lookups.
    userMethod: index('auth_methods_user_method').on(t.userId, t.methodType),
    // Finding #9 defence-in-depth (opaque-sync-hardening spec, Task A3): a
    // user has exactly one OPAQUE credential, so enforce that at the DB
    // layer as a backstop to the app-level assertOpaqueWrappingPresent
    // check. Must be partial (WHERE method_type = 'opaque') rather than a
    // full unique on (user_id, method_type) — a full index would reject the
    // second, third, … passkey row for any multi-passkey user.
    userOpaqueUnique: uniqueIndex('auth_methods_user_opaque_unique')
      .on(t.userId, t.methodType)
      .where(sql`${t.methodType} = 'opaque'`),
    passkeyCredentialUnique: uniqueIndex('auth_methods_passkey_credential')
      .on(t.passkeyCredentialId)
      .where(sql`${t.passkeyCredentialId} IS NOT NULL`),
  }),
);

export const pendingCodes = pgTable('pending_codes', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  type: text('type').$type<'invitation' | 'pairing'>().notNull(),
  codeHmac: bytea('code_hmac').notNull().unique(),
  role: invitationRole('role'), // invitation-only; NULL for pairing rows
  suggestedUsername: text('suggested_username'), // invitation-only
  issuerLabel: text('issuer_label'), // invitation-only
  note: text('note'), // invitation-only
  attemptCount: integer('attempt_count').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  redeemedByUserId: uuid('redeemed_by_user_id').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedToId: uuid('rotated_to_id'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    userFamily: index('refresh_tokens_user_family').on(t.userId, t.familyId),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: uuid('user_id'),
    actorUserId: uuid('actor_user_id'),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    createdAt: index('audit_log_created_at').on(t.createdAt),
    userIdx: index('audit_log_user_id').on(t.userId).where(sql`${t.userId} IS NOT NULL`),
  }),
);
