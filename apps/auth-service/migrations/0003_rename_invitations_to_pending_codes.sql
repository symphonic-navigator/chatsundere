-- Rename invitations to pending_codes and extend for cross-device-identity.
-- Adds the type discriminator (invitation vs pairing) and the new
-- suggested_username / note fields per the cross-device-identity API spec.

ALTER TABLE "invitations" RENAME TO "pending_codes";
ALTER TABLE "pending_codes" RENAME COLUMN "token_hmac" TO "code_hmac";

-- type discriminator. Existing rows are pre-public invitations.
ALTER TABLE "pending_codes" ADD COLUMN "type" text NOT NULL DEFAULT 'invitation';
ALTER TABLE "pending_codes" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "pending_codes" ADD CONSTRAINT "pending_codes_type_check"
  CHECK ("type" IN ('invitation', 'pairing'));

-- invitation-only fields (NULL for pairing rows)
ALTER TABLE "pending_codes" ADD COLUMN "suggested_username" text;
ALTER TABLE "pending_codes" ADD COLUMN "note" text;
