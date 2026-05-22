// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { generateCode, hashCode, isValidCodeFormat } from '../../src/codes/token.js';

// RFC 4648 §6 Base32 minus the four ambiguous characters {0, O, 1, I}.
const VALID_CHAR = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]$/;
const CODE_FORMAT = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;

describe('codes/token', () => {
  describe('generateCode', () => {
    it('returns a 10-character token formatted as AAAAA-BBBBB', () => {
      const code = generateCode();
      expect(code).toMatch(CODE_FORMAT);
    });

    it('uses only ambiguity-removed Base32 characters across many samples', () => {
      for (let i = 0; i < 500; i++) {
        const code = generateCode();
        for (const ch of code.replace('-', '')) {
          expect(VALID_CHAR.test(ch)).toBe(true);
        }
      }
    });

    it('produces distinct codes across 1000 calls (collision check)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) seen.add(generateCode());
      expect(seen.size).toBe(1000);
    });
  });

  describe('hashCode', () => {
    it('returns a 32-byte digest', async () => {
      const digest = await hashCode('AB7K3-MN9PX');
      expect(digest.length).toBe(32);
    });

    it('is deterministic for the same input', async () => {
      const a = await hashCode('AB7K3-MN9PX');
      const b = await hashCode('AB7K3-MN9PX');
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('differs for different inputs', async () => {
      const a = await hashCode('AB7K3-MN9PX');
      const b = await hashCode('CD8L4-NP6QY');
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    });
  });

  describe('isValidCodeFormat', () => {
    it('accepts properly-formatted codes', () => {
      expect(isValidCodeFormat('AB7K3-MN9PX')).toBe(true);
      expect(isValidCodeFormat('22222-33333')).toBe(true);
      expect(isValidCodeFormat('ZZZZZ-YYYYY')).toBe(true);
    });

    it('rejects codes containing ambiguous characters', () => {
      expect(isValidCodeFormat('AB7K3-MN0PX')).toBe(false); // contains 0 (zero)
      expect(isValidCodeFormat('AB7K3-MNOPX')).toBe(false); // contains O (oh)
      expect(isValidCodeFormat('AB7K3-MN1PX')).toBe(false); // contains 1 (one)
      expect(isValidCodeFormat('AB7K3-MNIPX')).toBe(false); // contains I (eye)
    });

    it('rejects codes with wrong shape', () => {
      expect(isValidCodeFormat('AB7K3MN9PX')).toBe(false); // no hyphen
      expect(isValidCodeFormat('AB7K3-MN9P')).toBe(false); // too short
      expect(isValidCodeFormat('AB7K3-MN9PXX')).toBe(false); // too long
      expect(isValidCodeFormat('ab7k3-mn9px')).toBe(false); // lowercase not accepted
      expect(isValidCodeFormat('AB7K3 MN9PX')).toBe(false); // space instead of hyphen
      expect(isValidCodeFormat('')).toBe(false);
    });

    it('accepts a freshly-generated code', () => {
      for (let i = 0; i < 50; i++) {
        expect(isValidCodeFormat(generateCode())).toBe(true);
      }
    });
  });
});
