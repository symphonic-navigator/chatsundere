// SPDX-License-Identifier: AGPL-3.0-only

/** One regular file to place in the archive. */
export interface TarFile {
  name: string;
  bytes: Uint8Array;
}

function octal(value: number, length: number): string {
  // length-1 octal digits, space-padded NUL-terminated field (ustar convention)
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function writeString(block: Uint8Array, offset: number, text: string): void {
  const bytes = new TextEncoder().encode(text);
  block.set(bytes, offset);
}

/** Build a ustar tarball from regular-file entries (no directories). */
export function tar(files: TarFile[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const file of files) {
    const header = new Uint8Array(512);
    writeString(header, 0, file.name); // name (max 100 bytes; our names are short)
    writeString(header, 100, '0000644\0'); // mode
    writeString(header, 108, '0000000\0'); // uid
    writeString(header, 116, '0000000\0'); // gid
    writeString(header, 124, octal(file.bytes.length, 12)); // size
    writeString(header, 136, octal(0, 12)); // mtime (0 — deterministic, no Date)
    header[156] = 0x30; // typeflag '0' = regular file
    writeString(header, 257, 'ustar\0'); // magic
    writeString(header, 263, '00'); // version
    // Checksum: sum of all header bytes with the checksum field taken as spaces.
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
    writeString(header, 148, octal(sum, 7)); // 6 octal digits + NUL
    header[155] = 0x20; // trailing space
    blocks.push(header);

    const padded = new Uint8Array(Math.ceil(file.bytes.length / 512) * 512);
    padded.set(file.bytes);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = end-of-archive trailer

  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

/** Compress a buffer using the platform CompressionStream (counterpart to gunzip). */
export async function gzip(buf: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const plain: Uint8Array<ArrayBuffer> = new Uint8Array(buf);
  writer.write(plain).catch(() => {});
  writer.close().catch(() => {});
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}
