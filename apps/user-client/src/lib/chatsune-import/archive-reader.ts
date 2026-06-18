// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatsuneManifest } from './types.js';

export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

export interface ChatsuneArchive {
  manifest: ChatsuneManifest;
  files: Map<string, Uint8Array>;
}

/** Parse a (decompressed) ustar tarball into its regular-file entries. */
export function untar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  const dec = new TextDecoder();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // A zero name field marks the end-of-archive trailer.
    if (header[0] === 0) break;
    const rawName = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    const sizeStr = dec.decode(header.subarray(124, 136)).replace(/[\0 ]/g, '');
    const size = Number.parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];
    offset += 512;
    // typeFlag '0' (0x30) or '\0' (0x00) is a regular file; skip directories etc.
    if ((typeFlag === 0x30 || typeFlag === 0x00) && rawName) {
      entries.push({ name: rawName, bytes: buf.subarray(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Decompress a gzip buffer using the platform DecompressionStream. */
export async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  // Copy into a fresh ArrayBuffer so the type is never SharedArrayBuffer — required
  // by the WritableStreamDefaultWriter.write() overload under strict lib types.
  const plain: Uint8Array<ArrayBuffer> = new Uint8Array(buf);
  // Suppress secondary write/close rejections — the readable side is the
  // authoritative error source; silencing these prevents unhandled-rejection noise.
  writer.write(plain).catch(() => {});
  writer.close().catch(() => {});
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function toBytes(input: Blob | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(await input.arrayBuffer());
}

/**
 * Read a chatsune `.tar.gz` export: gunzip, untar, index files by name, and
 * parse the required `manifest.json`. Throws user-facing errors on a
 * non-archive file or a missing manifest.
 */
export async function readChatsuneArchive(input: Blob | Uint8Array): Promise<ChatsuneArchive> {
  const raw = await toBytes(input);
  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzip(raw);
  } catch {
    throw new Error('Could not read this file — is it a Chatsune export?');
  }
  const files = new Map<string, Uint8Array>();
  for (const e of untar(tarBytes)) files.set(e.name, e.bytes);
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) {
    throw new Error('This file is not a Chatsune export (no manifest).');
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ChatsuneManifest;
  return { manifest, files };
}
