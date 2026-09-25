// SPDX-License-Identifier: AGPL-3.0-only

const serviceRoot = new URL('../', import.meta.url).pathname;
const testEnv = { ...process.env };
for (const key of [
  'TEST_DATABASE_URL',
  'OPAQUE_SERVER_SETUP',
  'ALLOW_EPHEMERAL_OPAQUE_SETUP',
  'APP_PUBLIC_URL',
  'SYNC_BLOBS_ENABLED',
  'TRUST_PROXY_HOPS',
]) {
  Reflect.deleteProperty(testEnv, key);
}
Object.assign(testEnv, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: '0',
  API_BASE_URL: 'http://localhost:3100/auth',
  DATABASE_URL:
    process.env.AUTH_TEST_DATABASE_URL ?? 'postgres://chatsundere:dev@localhost:5432/auth_test_db',
  REDIS_URL: process.env.AUTH_TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  AUTH_JWT_PRIVATE_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
  INVITATION_HMAC_KEY: Buffer.from(new Uint8Array(32).fill(11)).toString('base64url'),
  REFRESH_TOKEN_HMAC_KEY: Buffer.from(new Uint8Array(32).fill(13)).toString('base64url'),
  HMAC_KEY_PENDING_CODES: Buffer.from(new Uint8Array(32).fill(17)).toString('base64url'),
  DECOY_WRAP_KEY: Buffer.from(new Uint8Array(32).fill(19)).toString('base64url'),
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  PROXY_PUBLIC_URL: 'https://proxy.example',
  SYNC_PUBLIC_URL: 'https://sync.example',
  ADMIN_PUBLIC_URL: 'https://admin.example',
});
if (process.env.TEST_DATABASE_URL) {
  testEnv.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const reset = Bun.spawn(['bun', '--no-env-file', 'run', 'tests/reset-db.ts'], {
  cwd: serviceRoot,
  env: testEnv,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
const resetExitCode = await reset.exited;
if (resetExitCode !== 0) process.exit(resetExitCode);

const tests = Bun.spawn(
  ['bun', '--no-env-file', 'test', '--parallel=1', ...process.argv.slice(2)],
  {
    cwd: serviceRoot,
    env: testEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
process.exit(await tests.exited);
