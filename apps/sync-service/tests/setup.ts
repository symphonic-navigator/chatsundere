// SPDX-License-Identifier: AGPL-3.0-only

// Test-mode env defaults. Integration tests use TEST_DATABASE_URL; DATABASE_URL
// is pointed at the SAME test database so route code (createDb) and the test
// harness (withTestDb) converge on one isolated store.
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.PORT ??= '0';
process.env.OPS_PORT ??= '0';
process.env.TEST_DATABASE_URL ??= 'postgres://chatsundere:dev@localhost:5432/sync_db_test';
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.AUTH_JWKS_URL ??= 'http://localhost:3100/api/v1/jwks';
