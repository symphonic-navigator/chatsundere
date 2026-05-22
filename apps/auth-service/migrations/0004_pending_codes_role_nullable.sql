-- Pairing-code rows do not carry a role (only invitation-code rows do).
-- Migration 0003 added the type discriminator and the pairing-code use case
-- but left the role column constraint as NOT NULL (inherited from when the
-- table was invitations-only). Drop the NOT NULL constraint and the legacy
-- default so pairing-code inserts can leave role as NULL.

ALTER TABLE "pending_codes" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "pending_codes" ALTER COLUMN "role" DROP DEFAULT;
