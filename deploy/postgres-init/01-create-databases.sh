#!/usr/bin/env bash
# Runs on first Postgres start (empty data dir). Creates the two application
# databases owned by the app user. proxy-service is stateless (Redis only).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    SELECT 'CREATE DATABASE auth_db OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec
    SELECT 'CREATE DATABASE sync_db OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db')\gexec
EOSQL
