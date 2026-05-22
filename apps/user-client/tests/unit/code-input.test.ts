// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isValidCode, normaliseCodeInput } from '../../src/lib/code-input.js';

describe('normaliseCodeInput', () => {
  it('uppercases letters on the fly', () => {
    expect(normaliseCodeInput('ab7k3mn9pn')).toBe('AB7K3-MN9PN');
  });

  it('maps I → 1', () => {
    expect(normaliseCodeInput('IBC12')).toBe('1BC12');
  });

  it('maps L → 1', () => {
    expect(normaliseCodeInput('LBC12')).toBe('1BC12');
  });

  it('maps O → 0', () => {
    expect(normaliseCodeInput('OBC12')).toBe('0BC12');
  });

  it('maps V → Y (the V↔U swap)', () => {
    expect(normaliseCodeInput('VBC12')).toBe('YBC12');
  });

  it('keeps U in the alphabet', () => {
    expect(normaliseCodeInput('UBC12')).toBe('UBC12');
  });

  it('strips foreign characters', () => {
    expect(normaliseCodeInput('AB-7K!3MN9PN')).toBe('AB7K3-MN9PN');
    expect(normaliseCodeInput('  AB7K3 MN9PN  ')).toBe('AB7K3-MN9PN');
  });

  it('auto-inserts the hyphen after position 5', () => {
    expect(normaliseCodeInput('AB7K3')).toBe('AB7K3');
    expect(normaliseCodeInput('AB7K3M')).toBe('AB7K3-M');
    expect(normaliseCodeInput('AB7K3MN9PN')).toBe('AB7K3-MN9PN');
  });

  it('truncates beyond 10 alphabet chars', () => {
    expect(normaliseCodeInput('AB7K3MN9PNEXTRA')).toBe('AB7K3-MN9PN');
  });
});

describe('isValidCode', () => {
  it('accepts the canonical 10-char hyphenated form', () => {
    expect(isValidCode('AB7K3-MN9PN')).toBe(true);
    expect(isValidCode('UB7K3-MN9PN')).toBe(true);
    expect(isValidCode('00000-11111')).toBe(true);
  });

  it('rejects out-of-alphabet chars', () => {
    expect(isValidCode('IB7K3-MN9PN')).toBe(false);
    expect(isValidCode('LB7K3-MN9PN')).toBe(false);
    expect(isValidCode('OB7K3-MN9PN')).toBe(false);
    expect(isValidCode('VB7K3-MN9PN')).toBe(false);
  });

  it('rejects malformed shape', () => {
    expect(isValidCode('AB7K3MN9PN')).toBe(false); // missing hyphen
    expect(isValidCode('AB7K3-MN9P')).toBe(false); // too short
    expect(isValidCode('AB7K3-MN9PNX')).toBe(false); // too long
    expect(isValidCode('ab7k3-mn9pn')).toBe(false); // lowercase
  });
});
