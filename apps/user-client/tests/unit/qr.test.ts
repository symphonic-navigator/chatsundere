// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseInvitationPayload, parseInvitationUrl } from '../../src/lib/qr.js';
import type { InvitationQrPayload } from '../../src/lib/qr.js';

const VALID_PAYLOAD: InvitationQrPayload = {
  v: 1,
  kind: 'invitation',
  token: 'tok-abc123def456ghi7',
  base_url: 'https://chat.example.com',
  role: 'user',
  issuer_label: 'Example Org',
};

function encodePayloadToBase64Url(payload: unknown): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(json);
  // Convert standard base64 to base64url.
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('parseInvitationPayload', () => {
  it('round-trips a valid JSON string', () => {
    const raw = JSON.stringify(VALID_PAYLOAD);
    const result = parseInvitationPayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(VALID_PAYLOAD);
    }
  });

  it('rejects JSON with wrong "kind"', () => {
    const bad = { ...VALID_PAYLOAD, kind: 'something_else' };
    const result = parseInvitationPayload(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects JSON with wrong version number', () => {
    const bad = { ...VALID_PAYLOAD, v: 2 };
    const result = parseInvitationPayload(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects JSON with missing token', () => {
    const { token: _omitted, ...bad } = VALID_PAYLOAD;
    const result = parseInvitationPayload(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects JSON with an invalid base_url', () => {
    const bad = { ...VALID_PAYLOAD, base_url: 'not-a-url' };
    const result = parseInvitationPayload(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects non-JSON strings', () => {
    const result = parseInvitationPayload('definitely not json');
    expect(result.ok).toBe(false);
  });
});

describe('parseInvitationUrl', () => {
  it('extracts and validates a payload from a well-formed deep-link URL', () => {
    const encoded = encodePayloadToBase64Url(VALID_PAYLOAD);
    const url = `https://example.org/link?payload=${encoded}`;
    const result = parseInvitationUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(VALID_PAYLOAD);
    }
  });

  it('rejects a URL that is missing the payload query parameter', () => {
    const result = parseInvitationUrl('https://example.org/link?other=value');
    expect(result.ok).toBe(false);
  });

  it('also accepts bare JSON strings (falls back to parseInvitationPayload)', () => {
    const raw = JSON.stringify(VALID_PAYLOAD);
    const result = parseInvitationUrl(raw);
    expect(result.ok).toBe(true);
  });
});
