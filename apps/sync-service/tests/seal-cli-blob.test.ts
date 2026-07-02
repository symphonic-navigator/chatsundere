// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromBase64Url } from '@chatsundere/crypto';
import { blobOpenFile, blobSealFile, mintMk } from '../tools/seal-cli.js';

describe('seal-cli blob subcommands', () => {
  test('blob-seal → blob-open round-trips a file byte-identically', async () => {
    const mk = mintMk();
    const dir = tmpdir();
    const inPath = join(dir, `blobcli-in-${process.pid}`);
    const sealedPath = join(dir, `blobcli-sealed-${process.pid}`);
    const outPath = join(dir, `blobcli-out-${process.pid}`);
    const original = new Uint8Array(50_000);
    globalThis.crypto.getRandomValues(original.subarray(0, 50_000));
    await Bun.write(inPath, original);

    const { blobId, hashB64 } = await blobSealFile(mk, inPath, sealedPath);
    expect(blobId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fromBase64Url(hashB64).length).toBe(32);
    // Sealed body = plaintext + nonce(12) + tag(16).
    expect((await Bun.file(sealedPath).arrayBuffer()).byteLength).toBe(50_000 + 28);

    await blobOpenFile(mk, blobId, sealedPath, outPath);
    const roundTripped = new Uint8Array(await Bun.file(outPath).arrayBuffer());
    expect(roundTripped.length).toBe(original.length);
    expect(roundTripped[0]).toBe(original[0]);
    expect(roundTripped[roundTripped.length - 1]).toBe(original[original.length - 1]);
  });
});
