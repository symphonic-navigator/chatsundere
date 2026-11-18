// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { keyTestFailure } from '../../src/lib/key-test-failure.js';

const base = { providerName: 'Chutes', viaRelay: false };

describe('keyTestFailure — a failed probe mapped to a cause and a next step', () => {
  it('status 0 routed direct: unreachable, perhaps refusing browsers', () => {
    expect(keyTestFailure({ ...base, status: 0, reason: 'Failed to fetch' })).toEqual({
      message:
        "Couldn't reach Chutes. Check your connection. If it works, Chutes may not accept requests from a browser.",
      detail: '0 · Failed to fetch',
    });
  });

  it("status 0 through the relay: names the server's relay", () => {
    expect(
      keyTestFailure({ ...base, viaRelay: true, status: 0, reason: 'Failed to fetch' }).message,
    ).toBe(
      "Couldn't reach Chutes through your server's relay. Check your connection, or try again in a moment.",
    );
  });

  it.each([401, 403])('%i: the key was not accepted', (status) => {
    expect(keyTestFailure({ ...base, status, reason: 'Unauthorized' }).message).toBe(
      "Chutes didn't accept this key. Check that it was copied in full and is still active.",
    );
  });

  it('429: busy or rate-limiting', () => {
    expect(keyTestFailure({ ...base, status: 429 }).message).toBe(
      'Chutes is busy or rate-limiting this key. Try again in a minute.',
    );
  });

  it('anything else: names the status', () => {
    expect(keyTestFailure({ ...base, status: 502, reason: 'Bad Gateway' })).toEqual({
      message: 'Chutes answered with an error (502).',
      detail: '502 · Bad Gateway',
    });
  });

  it('keeps the raw detail without a dangling separator when there is no reason', () => {
    expect(keyTestFailure({ ...base, status: 429 }).detail).toBe('429');
  });
});
