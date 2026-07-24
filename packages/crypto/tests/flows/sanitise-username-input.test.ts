// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import {
  USERNAME_MAX_LENGTH,
  sanitiseUsernameInput,
  validateUsername,
} from '../../src/flows/create-local-account.js';

describe('sanitiseUsernameInput', () => {
  it('lowercases ASCII letters', () => {
    expect(sanitiseUsernameInput('Chris')).toBe('chris');
    expect(sanitiseUsernameInput('ALICE')).toBe('alice');
  });

  it('strips characters outside a-z 0-9 _ -', () => {
    expect(sanitiseUsernameInput('alice!')).toBe('alice');
    expect(sanitiseUsernameInput('bob@home')).toBe('bobhome');
    expect(sanitiseUsernameInput('a b c')).toBe('abc');
  });

  it('strips leading digits, underscores and hyphens', () => {
    expect(sanitiseUsernameInput('1alice')).toBe('alice');
    expect(sanitiseUsernameInput('_bob')).toBe('bob');
    expect(sanitiseUsernameInput('--carol')).toBe('carol');
    expect(sanitiseUsernameInput('99')).toBe('');
  });

  it('keeps valid mid-string digits and separators', () => {
    expect(sanitiseUsernameInput('alice_42')).toBe('alice_42');
    expect(sanitiseUsernameInput('bob-smith')).toBe('bob-smith');
  });

  it('caps length at USERNAME_MAX_LENGTH', () => {
    const long = `a${'b'.repeat(40)}`;
    const out = sanitiseUsernameInput(long);
    expect(out.length).toBe(USERNAME_MAX_LENGTH);
    expect(out.startsWith('a')).toBe(true);
  });

  it('is idempotent on already-valid names', () => {
    expect(sanitiseUsernameInput('alice')).toBe('alice');
  });

  it('produces strings that pass validateUsername when long enough and not reserved', () => {
    const cleaned = sanitiseUsernameInput('Chris!!');
    expect(cleaned).toBe('chris');
    expect(() => validateUsername(cleaned)).not.toThrow();
  });
});
