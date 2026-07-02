// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { matchOrigin } from '../src/cors.js';

const allowed = ['https://app.chatsundere.me'];
describe('matchOrigin', () => {
  test('exact match', () =>
    expect(matchOrigin('https://app.chatsundere.me', allowed)).toBe('https://app.chatsundere.me'));
  test('suffix attack rejected', () =>
    expect(matchOrigin('https://app.chatsundere.me.evil.com', allowed)).toBeNull());
  test('null origin rejected', () => expect(matchOrigin('null', allowed)).toBeNull());
  test('missing origin rejected', () => expect(matchOrigin(null, allowed)).toBeNull());
});
