import { describe, expect, it } from 'vitest';
import { gzip, tar } from '../../../src/lib/archive/tar-write.js';
import { gunzip, untar } from '../../../src/lib/chatsune-import/archive-reader.js';

describe('tar writer', () => {
  it('round-trips files through tar → untar', () => {
    const enc = new TextEncoder();
    const files = [
      { name: 'manifest.json', bytes: enc.encode('{"format":"chatsundere/persona"}') },
      { name: 'blobs/a.bin', bytes: new Uint8Array([1, 2, 3, 0, 255, 7]) },
    ];
    const entries = untar(tar(files));
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'blobs/a.bin']);
    expect(entries[1]?.bytes).toEqual(files[1]?.bytes);
  });

  it('round-trips bytes through gzip → gunzip', async () => {
    const data = new Uint8Array([0, 1, 2, 250, 99, 0, 0, 17]);
    expect(await gunzip(await gzip(data))).toEqual(data);
  });

  it('pads each entry to a 512-byte boundary and appends the zero trailer', () => {
    const out = tar([{ name: 'x', bytes: new Uint8Array([9]) }]);
    // 512 header + 512 padded body + 1024 trailer = 2048
    expect(out.length).toBe(2048);
  });
});
