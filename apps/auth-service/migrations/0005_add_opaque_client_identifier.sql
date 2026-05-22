-- OPAQUE binds the registration record to the client-supplied identifier
-- (`identifiers.client`) at registration time. Both login and step-up must
-- present the *same* identifier at finishLogin/startLogin or verification
-- fails — and a subsequent username change desynchronises the live username
-- from the sealed identifier, locking the user out of OPAQUE entirely.
--
-- This column captures the client identifier as it was at registration time
-- so it survives username changes. Backfill from users.username is safe for
-- Phase 0: usernames have not yet been renamed for any OPAQUE-having user
-- (this is brand-new code), so the backfilled value equals the registration
-- value by construction.

ALTER TABLE "auth_methods" ADD COLUMN "opaque_client_identifier" text;

UPDATE "auth_methods"
SET "opaque_client_identifier" = (
  SELECT "username" FROM "users" WHERE "users"."id" = "auth_methods"."user_id"
)
WHERE "method_type" = 'opaque' AND "opaque_client_identifier" IS NULL;
