import * as v from 'valibot';
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  PassphrasePair,
  RecoveryKeyLike,
  scorePassphrase,
  validateUsername,
} from '../../src/lib/validators.js';

describe('validateUsername (re-export)', () => {
  it('accepts a valid username', () => {
    expect(() => validateUsername('alice')).not.toThrow();
  });

  it('throws on a clearly invalid username', () => {
    // Leading digit is not permitted by the crypto package rules.
    expect(() => validateUsername('1invalid')).toThrow();
  });
});

describe('PassphrasePair', () => {
  it('passes when both fields match and meet minimum length', () => {
    const result = v.safeParse(PassphrasePair, {
      passphrase: 'correct-horse',
      confirmation: 'correct-horse',
    });
    expect(result.success).toBe(true);
  });

  it('fails with "Passphrases must match." when passphrases differ', () => {
    const result = v.safeParse(PassphrasePair, {
      passphrase: 'correct-horse',
      confirmation: 'battery-staple',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.issues.map((i) => i.message);
      expect(messages).toContain('Passphrases must match.');
    }
  });

  it('fails with "At least 8 characters." when passphrase is too short', () => {
    const result = v.safeParse(PassphrasePair, {
      passphrase: 'short',
      confirmation: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.issues.map((i) => i.message);
      expect(messages).toContain('At least 8 characters.');
    }
  });
});

describe('RecoveryKeyLike', () => {
  const validKey = 'ABCDEFGHJKMNPQRSTVWXYZ1234567890ABCDEFGHJKMNPQRST2'; // 50 chars

  it('normalises lower-case input to upper-case', () => {
    const lower = validKey.toLowerCase();
    const result = v.safeParse(RecoveryKeyLike, lower);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output).toBe(validKey);
    }
  });

  it('strips spaces from input', () => {
    const withSpaces = `${validKey.slice(0, 25)} ${validKey.slice(25)}`;
    const result = v.safeParse(RecoveryKeyLike, withSpaces);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output).toBe(validKey);
    }
  });

  it('strips dashes from input', () => {
    const withDashes = `${validKey.slice(0, 10)}-${validKey.slice(10)}`;
    const result = v.safeParse(RecoveryKeyLike, withDashes);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output).toBe(validKey);
    }
  });

  it('fails when transformed string is under 50 characters', () => {
    const tooShort = 'ABCDEFGHJKMNPQRSTVWXYZ1234567890ABCDE'; // 37 chars
    const result = v.safeParse(RecoveryKeyLike, tooShort);
    expect(result.success).toBe(false);
  });
});

describe('scorePassphrase', () => {
  it('returns score 0 for a very short passphrase', () => {
    const { score } = scorePassphrase('ab');
    expect(score).toBe(0);
  });

  it('returns score 1 for a passphrase in the second bucket', () => {
    // "abcdefgh" — lowercase only: bits=26, length=8, entropy=8*log2(26)≈37.6
    // 36 ≤ 37.6 < 60 → score 2
    // Use a very short lower-only string: 5 chars → entropy=5*4.7≈23.5 → score 0
    // Need something in [36,60): "abcdefghij" → 10*4.7≈47 → score 2
    // For score 1 we need entropy in [28,36): "abcdefg" → 7*4.7≈33 → score 1
    const { score } = scorePassphrase('abcdefg');
    expect(score).toBe(1);
  });

  it('returns score 2 for a mid-range passphrase', () => {
    // "abcdefghij" → entropy ≈ 47.1 → score 2
    const { score } = scorePassphrase('abcdefghij');
    expect(score).toBe(2);
  });

  it('returns score 3 for a strong passphrase', () => {
    // Mixed case + digits: bits=62, length=12, entropy=12*log2(62)≈71.6 → score 3
    const { score } = scorePassphrase('Abcdefgh1234');
    expect(score).toBe(3);
  });

  it('returns score 4 for an excellent passphrase', () => {
    // All character classes + long: bits=94, length=20, entropy≈130 → score 4
    const { score } = scorePassphrase('Correct-Horse-Battery-Staple!1');
    expect(score).toBe(4);
  });

  it('returns the documented hint for each score', () => {
    expect(scorePassphrase('ab').hint).toBe('Too short to be safe.');
    expect(scorePassphrase('abcdefg').hint).toBe('Could be guessed.');
    expect(scorePassphrase('abcdefghij').hint).toBe('Acceptable.');
    expect(scorePassphrase('Abcdefgh1234').hint).toBe('Strong.');
    expect(scorePassphrase('Correct-Horse-Battery-Staple!1').hint).toBe('Excellent.');
  });
});
