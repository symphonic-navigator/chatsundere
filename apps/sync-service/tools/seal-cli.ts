// SPDX-License-Identifier: AGPL-3.0-only

// A tiny Bun CLI that seals/opens sync records with a given MK, so the §15/§18
// wire flow is actually executable by hand (and the living proof the envelope
// runs under Bun — Probe G's durable form on the Bun side).
//
//   bun tools/seal-cli.ts mint-mk
//   bun tools/seal-cli.ts seal --mk <b64url> --collection personas --key <id> --row '<json>'
//   bun tools/seal-cli.ts open --mk <b64url> --collection personas --blind-id <b64url> --record '<json>' [--key-field id]

import { asMasterKey, fromBase64Url, getRandomBytes, openRecord, sealRecord, toBase64Url } from '@chatsundere/crypto';
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
  process.stderr.write('usage: seal-cli <mint-mk|seal|open> [flags]\n');
  process.exitCode = 1;
}

if (import.meta.main) await main(process.argv.slice(2));
