// SPDX-License-Identifier: AGPL-3.0-only

// A tiny Bun CLI that seals/opens sync records with a given MK, so the §15/§18
// wire flow is actually executable by hand (and the living proof the envelope
// runs under Bun — Probe G's durable form on the Bun side).
//
//   bun tools/seal-cli.ts mint-mk
//   bun tools/seal-cli.ts seal --mk <b64url> --collection personas --key <id> --row '<json>'
//   bun tools/seal-cli.ts open --mk <b64url> --collection personas --blind-id <b64url> --record '<json>' [--key-field id]
//   bun tools/seal-cli.ts blob-seal --mk <b64url> --in <file> [--blob-id <id>] --out <file>
//   bun tools/seal-cli.ts blob-open --mk <b64url> --blob-id <id> --in <file> --out <file>

import {
  asMasterKey,
  fromBase64Url,
  getRandomBytes,
  mintBlobId,
  openBlob,
  openRecord,
  sealBlob,
  sealRecord,
  toBase64Url,
} from '@chatsundere/crypto';
import type { SyncPushRecord } from '@chatsundere/shared-types';

/** Mints a random 32-byte master key as base64url. */
export function mintMk(): string {
  return toBase64Url(getRandomBytes(32));
}

/** Seals a row into the §7.1 push wire record (baseRev 0, not deleted). */
export async function sealToWire(
  mkB64: string,
  collection: string,
  key: string,
  row: unknown,
): Promise<SyncPushRecord> {
  const mk = asMasterKey(fromBase64Url(mkB64));
  const sealed = await sealRecord(mk, collection, key, row);
  return {
    blindId: toBase64Url(sealed.blindId),
    collection: collection as SyncPushRecord['collection'],
    envelopeVersion: sealed.envelopeVersion,
    baseRev: 0,
    deleted: false,
    nonce: toBase64Url(sealed.nonce),
    ciphertext: toBase64Url(sealed.ciphertext),
    ciphertextHash: toBase64Url(sealed.ciphertextHash),
  };
}

/** Opens a pulled record, using `keyField` (default `id`) as the blind-id key extractor. */
export async function openFromWire(
  mkB64: string,
  collection: string,
  blindIdB64: string,
  record: { nonce: string; ciphertext: string },
  keyField = 'id',
): Promise<unknown> {
  const mk = asMasterKey(fromBase64Url(mkB64));
  return openRecord(
    mk,
    collection,
    fromBase64Url(blindIdB64),
    { nonce: fromBase64Url(record.nonce), ciphertext: fromBase64Url(record.ciphertext) },
    (r) => String((r as Record<string, unknown>)[keyField]),
  );
}

/**
 * Seals a file into a blob body on disk (blob spec §15). Mints a `blobId` when
 * none is given. Returns the `blobId` and the base64url `x-ciphertext-hash`.
 */
export async function blobSealFile(
  mkB64: string,
  inPath: string,
  outPath: string,
  blobIdArg?: string,
): Promise<{ blobId: string; hashB64: string }> {
  const mk = asMasterKey(fromBase64Url(mkB64));
  const bytes = new Uint8Array(await Bun.file(inPath).arrayBuffer());
  const blobId = blobIdArg ?? mintBlobId();
  const { body, hash } = await sealBlob(mk, blobId, bytes);
  await Bun.write(outPath, body);
  return { blobId, hashB64: toBase64Url(hash) };
}

/** Opens a sealed blob body from disk back to its plaintext file (blob spec §15). */
export async function blobOpenFile(
  mkB64: string,
  blobId: string,
  inPath: string,
  outPath: string,
): Promise<void> {
  const mk = asMasterKey(fromBase64Url(mkB64));
  const body = new Uint8Array(await Bun.file(inPath).arrayBuffer());
  const plain = await openBlob(mk, blobId, body);
  await Bun.write(outPath, plain);
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === 'mint-mk') {
    process.stdout.write(`${mintMk()}\n`);
    return;
  }
  if (command === 'seal') {
    const record = await sealToWire(
      arg(argv, 'mk') as string,
      arg(argv, 'collection') as string,
      arg(argv, 'key') as string,
      JSON.parse(arg(argv, 'row') as string),
    );
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }
  if (command === 'open') {
    const row = await openFromWire(
      arg(argv, 'mk') as string,
      arg(argv, 'collection') as string,
      arg(argv, 'blind-id') as string,
      JSON.parse(arg(argv, 'record') as string),
      arg(argv, 'key-field') ?? 'id',
    );
    process.stdout.write(`${JSON.stringify(row)}\n`);
    return;
  }
  if (command === 'blob-seal') {
    const { blobId, hashB64 } = await blobSealFile(
      arg(argv, 'mk') as string,
      arg(argv, 'in') as string,
      arg(argv, 'out') as string,
      arg(argv, 'blob-id'),
    );
    process.stdout.write(`${JSON.stringify({ blobId, xCiphertextHash: hashB64 })}\n`);
    return;
  }
  if (command === 'blob-open') {
    await blobOpenFile(
      arg(argv, 'mk') as string,
      arg(argv, 'blob-id') as string,
      arg(argv, 'in') as string,
      arg(argv, 'out') as string,
    );
    return;
  }
  process.stderr.write('usage: seal-cli <mint-mk|seal|open|blob-seal|blob-open> [flags]\n');
  process.exitCode = 1;
}

if (import.meta.main) await main(process.argv.slice(2));
