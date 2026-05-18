-- Add recovery-wrap columns to users so the server can return them during the
-- recovery challenge-response flow without needing a separate auth_method row.
-- These columns store the client's wrapped master-key recovery blob and its
-- associated nonce and AAD, all as opaque bytea values.
ALTER TABLE "users" ADD COLUMN "wrapped_mk_recovery" "bytea";
ALTER TABLE "users" ADD COLUMN "wrap_nonce_recovery" "bytea";
ALTER TABLE "users" ADD COLUMN "wrap_aad_recovery" "bytea";
