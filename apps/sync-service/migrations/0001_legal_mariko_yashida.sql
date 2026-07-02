CREATE TABLE IF NOT EXISTS "sync_blobs" (
	"account_id" uuid NOT NULL,
	"blob_id" text NOT NULL,
	"bytes" bigint NOT NULL,
	"ciphertext_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_blobs_account_id_blob_id_pk" PRIMARY KEY("account_id","blob_id")
);
