// SPDX-License-Identifier: AGPL-3.0-only
import { validateUsername } from '@chatsundere/crypto';
import * as v from 'valibot';

/**
 * Re-export — keeps validation logic in exactly one place.
 * Throws `CryptoError('invalid_input', ...)` on failure.
 */
export { validateUsername };

export const PassphrasePair = v.pipe(
  v.object({
    passphrase: v.pipe(v.string(), v.minLength(8, 'At least 8 characters.')),
    confirmation: v.string(),
  }),
  v.check((p) => p.passphrase === p.confirmation, 'Passphrases must match.'),
);

/** Crockford base32 with separators and checksum; details validated by packages/crypto. */
export const RecoveryKeyLike = v.pipe(
  v.string(),
  v.transform((s) => s.toUpperCase().replace(/[\s-]+/g, '')),
  v.minLength(50, "That doesn't look like a full recovery key."),
);

export interface PassphraseStrength {
  score: 0 | 1 | 2 | 3 | 4;
  hint: string;
}

/** Simple informational strength meter — not a gate on submission. */
export function scorePassphrase(p: string): PassphraseStrength {
  let bits = 0;
  if (/[a-z]/.test(p)) bits += 26;
  if (/[A-Z]/.test(p)) bits += 26;
  if (/\d/.test(p)) bits += 10;
  if (/[^A-Za-z0-9]/.test(p)) bits += 32;
  const entropy = p.length * Math.log2(Math.max(bits, 2));
  if (entropy < 28) return { score: 0, hint: 'Too short to be safe.' };
  if (entropy < 36) return { score: 1, hint: 'Could be guessed.' };
  if (entropy < 60) return { score: 2, hint: 'Acceptable.' };
  if (entropy < 90) return { score: 3, hint: 'Strong.' };
  return { score: 4, hint: 'Excellent.' };
}
