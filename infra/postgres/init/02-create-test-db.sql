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

SELECT 'CREATE DATABASE auth_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db_test')\gexec

SELECT 'CREATE DATABASE sync_db_test OWNER chatsundere'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db_test')\gexec
