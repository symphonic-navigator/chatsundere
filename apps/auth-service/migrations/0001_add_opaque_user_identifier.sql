-- Add opaque_user_identifier to auth_methods so the OPAQUE login flow can use the
-- same identifier that was bound at registration time (invitation.id).
-- The server must present the same userIdentifier at startServerLogin as was used
-- at createServerRegistrationResponse, otherwise OPAQUE credential verification fails.
ALTER TABLE "auth_methods" ADD COLUMN "opaque_user_identifier" text;
