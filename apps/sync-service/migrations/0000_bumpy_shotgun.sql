CREATE TABLE IF NOT EXISTS "sync_accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"head_rev" bigint DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_meta" (
	"instance_epoch" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_records" (
	"account_id" uuid NOT NULL,
	"blind_id" "bytea" NOT NULL,
	"collection" text NOT NULL,
	"envelope_version" smallint DEFAULT 1 NOT NULL,
	"rev" bigint NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"nonce" "bytea",
	"ciphertext" "bytea",
	"ciphertext_hash" "bytea",
	CONSTRAINT "sync_records_account_id_blind_id_pk" PRIMARY KEY("account_id","blind_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_records_account_rev_idx" ON "sync_records" USING btree ("account_id","rev");--> statement-breakpoint
INSERT INTO "sync_meta" DEFAULT VALUES;
