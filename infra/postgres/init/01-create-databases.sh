#!/usr/bin/env bash
# Runs on first container start (when /var/lib/postgresql/data is empty).
#
# Creates the per-service databases owned by the `chatsundere` user.
# auth_db + sync_db are the two application stores; the proxy-service is
# stateless (Redis only) and needs no database.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    -- auth_db already exists (created via POSTGRES_DB env), but ensuring is cheap.
    SELECT 'CREATE DATABASE auth_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec

    -- sync-service zero-knowledge ciphertext store.
    SELECT 'CREATE DATABASE sync_db OWNER chatsundere'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db')\gexec

    -- proxy-service is stateless (Redis only) — no proxy_db.
EOSQL
