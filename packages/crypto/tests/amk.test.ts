// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { deriveLocalAmk, deriveOpaqueAmk, derivePrfAmk, deriveRecoveryAmk } from '../src/amk.js';
import { asRecoveryKey } from '../src/types.js';

const FIXED_SALT = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
const FIXED_RK = asRecoveryKey(Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
const FIXED_EXPORT = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0x30 + i));
const FIXED_PRF = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0x60 + i));

describe('AMK derivations', () => {
  it('deriveLocalAmk returns a 32-byte AMK', async () => {
    const amk = await deriveLocalAmk('correct horse battery staple', FIXED_SALT);
    expect(amk.length).toBe(32);
  });

  it('deriveLocalAmk is deterministic for fixed inputs', async () => {
    const a = await deriveLocalAmk('passphrase', FIXED_SALT);
    const b = await deriveLocalAmk('passphrase', FIXED_SALT);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('deriveRecoveryAmk differs from deriveLocalAmk for distinct domains', async () => {
    const rk = await deriveRecoveryAmk(FIXED_RK);
    const lk = await deriveLocalAmk('rk-as-passphrase', FIXED_SALT);
    expect(Buffer.from(rk).equals(Buffer.from(lk))).toBe(false);
  });

  it('deriveOpaqueAmk produces 32 bytes and is deterministic', async () => {
    const a = await deriveOpaqueAmk(FIXED_EXPORT);
    const b = await deriveOpaqueAmk(FIXED_EXPORT);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('derivePrfAmk binds the credential prefix into the AMK', async () => {
    const a = await derivePrfAmk(FIXED_PRF, 'credA');
    const b = await derivePrfAmk(FIXED_PRF, 'credB');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
