// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import { encryptExportPack } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptTransferPack,
  readEncryptedContainer,
  wrapEncrypted,
} from '../../../src/lib/chatsundere-transfer/encrypted-container.js';
import { readManifestFormat } from '../../../src/lib/chatsundere-transfer/import-detect.js';
import { detectArchiveFormat } from '../../../src/lib/chatsundere-transfer/manifest.js';

const inner = new TextEncoder().encode('inner-pack-bytes');

describe('encrypted transfer container', () => {
  it('wraps a container and reads it back; detects as encrypted', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const blob = await wrapEncrypted(c, { appVersion: '9.9.9' });
    const back = await readEncryptedContainer(blob);
    expect(back.enclosedFormat).toBe('chatsundere/persona');
    expect(back.payload).toEqual(c.payload);
    expect(await readManifestFormat(blob)).toBe('chatsundere/encrypted');
  });

  it('decryptTransferPack returns the inner bytes with the right password', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/knowledge');
    const blob = await wrapEncrypted(c);
    const out = new Uint8Array(await (await decryptTransferPack(blob, 'pw')).arrayBuffer());
    expect(new TextDecoder().decode(out)).toBe('inner-pack-bytes');
  });

  it('decryptTransferPack rejects a wrong password', async () => {
    const c = await encryptExportPack('pw', inner, 'chatsundere/persona');
    const blob = await wrapEncrypted(c);
    await expect(decryptTransferPack(blob, 'nope')).rejects.toMatchObject({
      code: 'wrong_password',
    });
  });

  it('backward-compat: plaintext manifests without encryption fields still detect', () => {
    expect(detectArchiveFormat({ format: 'chatsundere/persona', version: 1 })).toBe(
      'chatsundere/persona',
    );
    expect(detectArchiveFormat({ format: 'chatsundere/knowledge', version: 1 })).toBe(
      'chatsundere/knowledge',
    );
  });
});
