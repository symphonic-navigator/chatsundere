-- Extensions required before any table that references their types.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Lightweight UUIDv7 polyfill for PostgreSQL 16.
-- PostgreSQL 17 ships uuidv7() built-in; drop this block when we upgrade.
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ms bigint;
  ts_bytes bytea;
  rand_bytes bytea;
  uuid_bytes bytea;
BEGIN
  unix_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  ts_bytes := substring(int8send(unix_ms) from 3 for 6);
  rand_bytes := gen_random_bytes(10);
  -- Set version 7 (4 most significant bits of byte 7 → 0b0111).
  rand_bytes := set_byte(rand_bytes, 0, (get_byte(rand_bytes, 0) & 15) | 112);
  -- Set variant RFC 4122 (2 most significant bits of byte 9 → 0b10).
  rand_bytes := set_byte(rand_bytes, 2, (get_byte(rand_bytes, 2) & 63) | 128);
  uuid_bytes := ts_bytes || rand_bytes;
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TYPE "public"."auth_method_type" AS ENUM('opaque', 'passkey');--> statement-breakpoint
CREATE TYPE "public"."invitation_role" AS ENUM('primary_admin', 'admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('primary_admin', 'admin', 'user');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_type" "auth_method_type" NOT NULL,
	"label" text,
	"opaque_credential" "bytea",
	"passkey_credential_id" "bytea",
	"passkey_public_key" "bytea",
	"passkey_sign_count" bigint,
	"passkey_aaguid" uuid,
	"passkey_transports" jsonb,
	"wrapped_master_key" "bytea" NOT NULL,
	"wrap_nonce" "bytea" NOT NULL,
	"wrap_algo" text DEFAULT 'AES-256-GCM' NOT NULL,
	"wrap_aad" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hmac" "bytea" NOT NULL,
	"role" "invitation_role" DEFAULT 'user' NOT NULL,
	"issuer_label" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invitations_token_hmac_unique" UNIQUE("token_hmac")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"family_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_to_id" uuid,
	"user_agent" text,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"username" "citext" NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"recovery_verifier_key" "bytea" NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"storage_quota_bytes" bigint,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_methods" ADD CONSTRAINT "auth_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id" ON "audit_log" USING btree ("user_id") WHERE "audit_log"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_methods_user_method" ON "auth_methods" USING btree ("user_id","method_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_methods_passkey_credential" ON "auth_methods" USING btree ("passkey_credential_id") WHERE "auth_methods"."passkey_credential_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_family" ON "refresh_tokens" USING btree ("user_id","family_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_primary_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'primary_admin';