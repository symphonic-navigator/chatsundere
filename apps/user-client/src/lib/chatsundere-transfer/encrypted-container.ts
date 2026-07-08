// SPDX-License-Identifier: AGPL-3.0-only

import { type EncryptedContainer, decryptExportPack } from '@chatsundere/crypto';
import { type TarFile, gzip, tar } from '../archive/tar-write.js';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type EncryptedManifest, TRANSFER_VERSION } from './manifest.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface WrapEncryptedOptions {
  exportedAt?: string;
  appVersion?: string;
}

/** Pack an `EncryptedContainer` into the standard gzip-tar envelope (`manifest.json` + `payload.bin`). */
export async function wrapEncrypted(
  container: EncryptedContainer,
  opts: WrapEncryptedOptions = {},
): Promise<Blob> {
  const manifest: EncryptedManifest = {
    format: 'chatsundere/encrypted',
    version: TRANSFER_VERSION,
    algoVersion: container.algoVersion,
    enclosedFormat: container.enclosedFormat,
    kdf: container.kdf,
    nonce: container.nonce,
    integrityHmac: container.integrityHmac,
    exportedAt: opts.exportedAt ?? '',
    appVersion: opts.appVersion ?? '',
  };
  const files: TarFile[] = [
    { name: 'manifest.json', bytes: enc.encode(JSON.stringify(manifest)) },
    { name: 'payload.bin', bytes: container.payload },
  ];
  const gz: Uint8Array<ArrayBuffer> = new Uint8Array(await gzip(tar(files)));
  return new Blob([gz], { type: 'application/gzip' });
}

/** Read an encrypted container back out of its gzip-tar envelope. */
export async function readEncryptedContainer(input: Blob): Promise<EncryptedContainer> {
  const raw = new Uint8Array(await input.arrayBuffer());
  const files = new Map<string, Uint8Array>();
  for (const e of untar(await gunzip(raw))) files.set(e.name, e.bytes);
  const manifestBytes = files.get('manifest.json');
  const payload = files.get('payload.bin');
  if (!manifestBytes || !payload) {
    throw new Error('This encrypted export is missing data — the file may be damaged.');
  }
  const manifest = JSON.parse(dec.decode(manifestBytes)) as EncryptedManifest;
  return {
    algoVersion: manifest.algoVersion,
    enclosedFormat: manifest.enclosedFormat,
    kdf: manifest.kdf,
    nonce: manifest.nonce,
    integrityHmac: manifest.integrityHmac,
    payload,
  };
}

/**
 * Decrypt an encrypted transfer pack to its inner plaintext pack Blob. Throws
 * `CryptoError('wrong_password')` when the password is wrong.
 */
export async function decryptTransferPack(input: Blob, password: string): Promise<Blob> {
  const container = await readEncryptedContainer(input);
  const innerBytes = await decryptExportPack(password, container);
  const inner: Uint8Array<ArrayBuffer> = new Uint8Array(innerBytes);
  return new Blob([inner], { type: 'application/gzip' });
}
