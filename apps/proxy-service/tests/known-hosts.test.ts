// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { normaliseLlmHost } from '../src/egress/known-hosts.js';

describe('normaliseLlmHost', () => {
  test('known host returns itself', () => expect(normaliseLlmHost('api.x.ai')).toBe('api.x.ai'));
  test('case-insensitive', () => expect(normaliseLlmHost('API.X.AI')).toBe('api.x.ai'));
  test('unknown host collapses to other', () => expect(normaliseLlmHost('evil.example')).toBe('other'));
  test('suffix attack collapses to other', () =>
    expect(normaliseLlmHost('api.x.ai.evil.com')).toBe('other'));
});
