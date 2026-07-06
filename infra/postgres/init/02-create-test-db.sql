-- Create the test database used by integration tests. Idempotent so that
-- restarting the dev compose without wiping the postgres volume is a no-op.
--
-- This database is created on first compose-up by virtue of being in the
-- /docker-entrypoint-initdb.d directory. Postgres only runs init scripts
-- when initialising an empty data directory. If you change this file and
-- the test DB already exists, run:
--
--   docker compose -f infra/compose.dev.yml down -v postgres
--   docker compose -f infra/compose.dev.yml up -d postgres
--
-- to rebuild the postgres volume from scratch.

-- auth's tests/setup.ts defaults DATABASE_URL to auth_test_db (note the name
-- differs from auth_db_test); auth_db_test is the dedicated DB a full auth
-- integration run points TEST_DATABASE_URL at. sync uses sync_db_test for both.
SELECT 'CREATE DATABASE auth_test_db OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_test_db')\gexec

SELECT 'CREATE DATABASE auth_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db_test')\gexec

SELECT 'CREATE DATABASE sync_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db_test')\gexec
