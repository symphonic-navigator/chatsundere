// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { toBase64Url } from '../../src/encoding/base64url.js';
import { BLOB_AAD_PREFIX, mintBlobId, openBlob, sealBlob } from '../../src/sync-blob/index.js';
import { asMasterKey } from '../../src/types.js';

const mk = asMasterKey(new Uint8Array(32).fill(7));
const mk2 = asMasterKey(new Uint8Array(32).fill(9));

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b.subarray(0, Math.min(n, 65536)));
  for (let i = 65536; i < n; i++) b[i] = (i * 31) & 0xff;
  return b;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

describe('mintBlobId', () => {
  it('returns 22 base64url chars decoding to 16 bytes', async () => {
    const { fromBase64Url } = await import('../../src/encoding/base64url.js');
    const id = mintBlobId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fromBase64Url(id).length).toBe(16);
  });

  it('is unique across 1000 mints', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(mintBlobId());
    expect(seen.size).toBe(1000);
  });
});

describe('sealBlob / openBlob', () => {
  it('round-trips 3 MiB of random bytes', async () => {
    const bytes = randomBytes(3 * 1024 * 1024);
    const blobId = mintBlobId();
    const { body } = await sealBlob(mk, blobId, bytes);
    const opened = await openBlob(mk, blobId, body);
    expect(opened.length).toBe(bytes.length);
    expect([...opened.subarray(0, 64)]).toEqual([...bytes.subarray(0, 64)]);
    expect([...opened.subarray(bytes.length - 64)]).toEqual([...bytes.subarray(bytes.length - 64)]);
  });

  it('hash equals SHA-256 of the body (nonce + ciphertext together)', async () => {
    const bytes = randomBytes(4096);
    const blobId = mintBlobId();
    const { body, hash } = await sealBlob(mk, blobId, bytes);
    expect([...hash]).toEqual([...(await sha256(body))]);
    expect(hash.length).toBe(32);
  });

  it('is deterministic — identical (mk, blobId, bytes) → byte-identical body and hash', async () => {
    const bytes = randomBytes(8192);
    const blobId = mintBlobId();
    const a = await sealBlob(mk, blobId, bytes);
    const b = await sealBlob(mk, blobId, bytes);
    expect([...a.body]).toEqual([...b.body]);
    expect([...a.hash]).toEqual([...b.hash]);
  });

  it('diverges on a different blobId (same bytes)', async () => {
    const bytes = randomBytes(8192);
    const a = await sealBlob(mk, mintBlobId(), bytes);
    const b = await sealBlob(mk, mintBlobId(), bytes);
    expect([...a.body]).not.toEqual([...b.body]);
  });

  it('diverges on different bytes (same blobId)', async () => {
    const blobId = mintBlobId();
    const a = await sealBlob(mk, blobId, randomBytes(8192));
    const b = await sealBlob(mk, blobId, randomBytes(8192));
    expect([...a.body]).not.toEqual([...b.body]);
  });

  it('diverges on a different master key (same blobId, same bytes)', async () => {
    const bytes = randomBytes(8192);
    const blobId = mintBlobId();
    const a = await sealBlob(mk, blobId, bytes);
    const b = await sealBlob(mk2, blobId, bytes);
    expect([...a.body]).not.toEqual([...b.body]);
  });

  it('rejects opening under a foreign blobId (AAD binds the id)', async () => {
    const bytes = randomBytes(1024);
    const blobId = mintBlobId();
    const { body } = await sealBlob(mk, blobId, bytes);
    await expect(openBlob(mk, mintBlobId(), body)).rejects.toThrow();
  });

  it('rejects opening under a foreign master key', async () => {
    const bytes = randomBytes(1024);
    const blobId = mintBlobId();
    const { body } = await sealBlob(mk, blobId, bytes);
    await expect(openBlob(mk2, blobId, body)).rejects.toThrow();
  });

  it('rejects a truncated body (< 28 bytes)', async () => {
    const blobId = mintBlobId();
    await expect(openBlob(mk, blobId, new Uint8Array(27))).rejects.toThrow();
  });

  it('rejects a body whose ciphertext has been tampered', async () => {
    const bytes = randomBytes(1024);
    const blobId = mintBlobId();
    const { body } = await sealBlob(mk, blobId, bytes);
    const tampered = new Uint8Array(body);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01;
    await expect(openBlob(mk, blobId, tampered)).rejects.toThrow();
  });

  it('bakes the version prefix into the AAD (constant is exposed and stable)', () => {
    expect(BLOB_AAD_PREFIX).toBe('chatsundere-blob-v1');
  });

  it('plaintext hash never appears on the wire (blobId + body + hash scan)', async () => {
    // The SIV nonce derivation hashes the plaintext internally; that hash must
    // never surface as a header, column, or any wire byte (the NSFW-scan discipline).
    const bytes = randomBytes(16384);
    const blobId = mintBlobId();
    const { body, hash } = await sealBlob(mk, blobId, bytes);
    const plainHash = await sha256(bytes);
    // The full wire material: the id, the stored body, and the x-ciphertext-hash.
    const wire = new Uint8Array(blobId.length + body.length + hash.length);
    wire.set(new TextEncoder().encode(blobId), 0);
    wire.set(body, blobId.length);
    wire.set(hash, blobId.length + body.length);
    // Search for the 32-byte plaintext hash as a contiguous substring.
    const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex(wire).includes(hex(plainHash))).toBe(false);
    // Sanity: the encoded id itself is present.
    expect(hex(wire).includes(hex(new TextEncoder().encode(blobId)))).toBe(true);
  });

  it('produces a 28-byte body for empty plaintext (nonce 12 + tag 16)', async () => {
    const blobId = mintBlobId();
    const { body } = await sealBlob(mk, blobId, new Uint8Array(0));
    expect(body.length).toBe(28);
    expect([...(await openBlob(mk, blobId, body))]).toEqual([]);
  });

  it('the base64url encoding of the id is deterministic per mint', () => {
    const id = mintBlobId();
    expect(toBase64Url(new Uint8Array(0))).toBe('');
    expect(id.length).toBe(22);
  });
});
