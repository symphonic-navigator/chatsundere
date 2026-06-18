// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { readChatsuneArchive, untar } from '../../../src/lib/chatsune-import/archive-reader.js';

/** Build a single ustar tar entry (one 512-byte header + padded data). */
function tarEntry(name: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name).slice(0, 100), 0);
  header.set(enc.encode('0000644'), 100); // mode
  header.set(enc.encode('0000000'), 108); // uid
  header.set(enc.encode('0000000'), 116); // gid
  // size as 11-octal-digit + NUL at offset 124
  const sizeOctal = content.length.toString(8).padStart(11, '0');
  header.set(enc.encode(sizeOctal), 124);
  header[135] = 0;
  header.set(enc.encode('00000000000'), 136); // mtime
  header[156] = '0'.charCodeAt(0); // typeflag = regular file
  header.set(enc.encode('ustar\0'), 257);
  header.set(enc.encode('00'), 263);
  // checksum: blanks during compute, then octal
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  header.set(enc.encode(sum.toString(8).padStart(6, '0')), 148);
  header[154] = 0;
  header[155] = 0x20;
  const padded = new Uint8Array(Math.ceil(content.length / 512) * 512);
  padded.set(content, 0);
  const out = new Uint8Array(header.length + padded.length);
  out.set(header, 0);
  out.set(padded, header.length);
  return out;
}

function makeTar(entries: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const blocks = entries.map((e) => tarEntry(e.name, enc.encode(e.content)));
  const trailer = new Uint8Array(1024); // two zero blocks
  const total = blocks.reduce((n, b) => n + b.length, 0) + trailer.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

async function gzip(buf: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  // Copy into a fresh ArrayBuffer so the type is never SharedArrayBuffer — required
  // by the WritableStreamDefaultWriter.write() overload under strict lib types.
  const plain: Uint8Array<ArrayBuffer> = new Uint8Array(buf);
  void writer.write(plain);
  void writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

describe('untar', () => {
  it('reads file names and contents back', () => {
    const tar = makeTar([
      { name: 'manifest.json', content: '{"format":"x","version":1}' },
      { name: 'persona.json', content: '{"name":"Fable"}' },
    ]);
    const entries = untar(tar);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'persona.json']);
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('{"name":"Fable"}');
  });
});

describe('readChatsuneArchive', () => {
  it('gunzips, untars, and parses the manifest', async () => {
    const tar = makeTar([
      { name: 'manifest.json', content: '{"format":"chatsune/persona","version":1}' },
      { name: 'persona.json', content: '{"name":"Fable"}' },
    ]);
    const gz = await gzip(tar);
    const archive = await readChatsuneArchive(gz);
    expect(archive.manifest.format).toBe('chatsune/persona');
    expect(archive.files.has('persona.json')).toBe(true);
  });

  it('throws a clear error when the file is not a gzip archive', async () => {
    await expect(readChatsuneArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /could not read this file/i,
    );
  });

  it('throws when manifest.json is missing', async () => {
    const gz = await gzip(makeTar([{ name: 'persona.json', content: '{}' }]));
    await expect(readChatsuneArchive(gz)).rejects.toThrow(/not a chatsune export/i);
  });
});
