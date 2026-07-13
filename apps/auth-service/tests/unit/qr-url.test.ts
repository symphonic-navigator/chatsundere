// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { buildJoinQrUrl } from '../../src/codes/qr-url.js';

// API_BASE_URL alone, cast to Env via `never` (the assertion bypasses
// checking every unrelated required Env field for what is deliberately a
// partial fixture). Kept as a plain literal — not spread — because spreading
// a `never`-typed value is a TS2698 error under this repo's strict tsconfig.
const baseUrl = 'https://auth.example.com/auth';

describe('buildJoinQrUrl', () => {
  test('with APP_PUBLIC_URL: client-origin form, server url-encoded, /auth stripped', () => {
    const env = {
      API_BASE_URL: baseUrl,
      APP_PUBLIC_URL: 'https://app.example.com',
    } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe(
      'https://app.example.com/join?server=https%3A%2F%2Fauth.example.com#ABCD-EFGH-JK',
    );
  });

  test('APP_PUBLIC_URL trailing slash is tolerated', () => {
    const env = {
      API_BASE_URL: baseUrl,
      APP_PUBLIC_URL: 'https://app.example.com/',
    } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe(
      'https://app.example.com/join?server=https%3A%2F%2Fauth.example.com#ABCD-EFGH-JK',
    );
  });

  test('without APP_PUBLIC_URL: legacy form WITH the /auth strip (B1 fix)', () => {
    const env = { API_BASE_URL: baseUrl } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe('https://auth.example.com/join#ABCD-EFGH-JK');
  });

  test('API_BASE_URL without /auth suffix is passed through unchanged', () => {
    const env = { API_BASE_URL: 'https://chat.example.com' } as never;
    expect(buildJoinQrUrl(env, 'ABCD-EFGH-JK')).toBe('https://chat.example.com/join#ABCD-EFGH-JK');
  });
});
