-- Finding #9 defence-in-depth (opaque-sync-hardening spec, Task A3): a DB-
-- level backstop for assertOpaqueWrappingPresent's app-level guard. Combined
-- with the (now-fixed) recovery nonce GETDEL race, two concurrent
-- recovery/finish calls could previously leave two 'opaque' auth_methods
-- rows for one user, poisoning later OPAQUE lookups that assume LIMIT 1.
--
-- Must be PARTIAL, not a full unique index on (user_id, method_type): a user
-- has exactly one OPAQUE credential but MAY hold many passkeys (one per
-- registered authenticator, see routes/link.ts). A full unique index would
-- reject the second passkey a user adds. Scoping to method_type = 'opaque'
-- enforces the single-instance invariant only where it actually holds.
--
-- The plain auth_methods_user_method index from migration 0000 is retained
-- (not dropped): passkey lookups filtered by (user_id, method_type =
-- 'passkey') still need a usable index, and this partial index's predicate
-- does not cover them.

CREATE UNIQUE INDEX "auth_methods_user_opaque_unique" ON "auth_methods" ("user_id","method_type") WHERE "method_type" = 'opaque';
