#!/usr/bin/env bash
# Runs on first container start (when /var/lib/postgresql/data is empty).
#
# Creates the per-service databases owned by the `chatsundere` user.
# auth_db is the only one we need in Phase 0; sync_db and proxy_db are
# added here when their services come online.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    -- auth_db already exists (created via POSTGRES_DB env), but ensuring is cheap.
    SELECT 'CREATE DATABASE auth_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

    -- Phase 1: uncomment when sync-service ships its real schema.
    -- CREATE DATABASE sync_db OWNER chatsundere;

    -- Phase 2: uncomment when proxy-service ships its real schema.
    -- CREATE DATABASE proxy_db OWNER chatsundere;
EOSQL
