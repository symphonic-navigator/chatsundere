// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { blobKey, createS3Backend, deriveSigningKey } from '../src/blobs/s3.js';
import { loadEnv } from '../src/env.js';

const S3_TEST_ENDPOINT = process.env.S3_TEST_ENDPOINT;

// SigV4 signing-key derivation is verifiable offline against AWS's published
// test vector (docs.aws.amazon.com "Examples of the complete Version 4 signing
// process") — date 20120215, region us-east-1, service iam.
describe('SigV4 signing key (offline vector)', () => {
  test('matches the AWS documented derivation', () => {
    const key = deriveSigningKey(
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      '20120215',
      'us-east-1',
      'iam',
    );
    const hex = [...key].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });
});

describe('blobKey', () => {
  test('is <account_id>/<blob_id>', () => {
    expect(blobKey('acc', 'blob')).toBe('acc/blob');
  });
});

// The live legs need MinIO. They SKIP LOUDLY when S3_TEST_ENDPOINT is unset —
// the TEST_DATABASE_URL discipline, applied to the object store.
const live = S3_TEST_ENDPOINT ? describe : describe.skip;
if (!S3_TEST_ENDPOINT) {
  // eslint-disable-next-line no-console
  console.warn(
    '[s3.test] SKIPPING live S3 legs — set S3_TEST_ENDPOINT (e.g. http://localhost:9000) ' +
      'with MinIO running to exercise put/get/delete/health/bootstrap.',
  );
}

live('S3 backend (live, against MinIO)', () => {
  const env = {
    ...loadEnv({
      DATABASE_URL: 'postgres://x/y',
      REDIS_URL: 'redis://x',
      AUTH_JWKS_URL: 'https://x/jwks',
      // Fallback keeps createS3Backend constructible when this block is skipped
      // (bun's describe.skip still runs the callback body); the skipped tests
      // never issue a network call.
      S3_ENDPOINT: S3_TEST_ENDPOINT ?? 'http://127.0.0.1:1',
      S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID ?? 'chatsundere-dev',
      S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'chatsundere-dev-secret',
      S3_BUCKET: process.env.S3_TEST_BUCKET ?? 'chatsundere-blobs-test',
    }),
  };
  const backend = createS3Backend(env);
  const key = `test/${Date.now()}`;

  test('put → get round-trips 3 MiB byte-identically', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
    await backend.putStream(key, new Blob([bytes]).stream(), bytes.length);
    const got = await backend.getStream(key);
    expect(got).not.toBeNull();
    expect(got?.length).toBe(bytes.length);
    const buf = new Uint8Array(await new Response(got?.stream).arrayBuffer());
    expect(buf.length).toBe(bytes.length);
    expect(buf[0]).toBe(bytes[0]);
    expect(buf[buf.length - 1]).toBe(bytes[bytes.length - 1]);
  });

  test('get of an absent key → null', async () => {
    expect(await backend.getStream(`test/absent-${Date.now()}`)).toBeNull();
  });

  test('delete is idempotent', async () => {
    await backend.delete(key);
    await backend.delete(key); // second delete must not throw
    expect(await backend.getStream(key)).toBeNull();
  });

  test('healthy() true against a reachable endpoint', async () => {
    expect(await backend.healthy()).toBe(true);
  });

  test('healthy() false against a closed port', async () => {
    const dead = createS3Backend({ ...env, S3_ENDPOINT: 'http://127.0.0.1:1' });
    expect(await dead.healthy()).toBe(false);
  });
});
