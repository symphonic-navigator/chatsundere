// SPDX-License-Identifier: LGPL-3.0-only
import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { decodeRecoveryKey, encodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { asRecoveryKey } from '../../src/types.js';

describe('recovery key encoding (property)', () => {
  it('encode then decode is identity', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (bytes) => {
        const rk = asRecoveryKey(bytes);
        const enc = encodeRecoveryKey(rk);
        const dec = decodeRecoveryKey(enc);
        return Buffer.from(dec).equals(Buffer.from(bytes));
      }),
      { numRuns: 50 },
    );
  });
});
