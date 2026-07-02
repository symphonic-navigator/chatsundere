// SPDX-License-Identifier: AGPL-3.0-only

import type { AppSession } from '@chatsundere/ui-shared';
import { useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// Partial crypto mock: real encoding/base64url helpers stay real so the pure
// converters round-trip genuine bytes; only the linked-flow pieces are stubbed.

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return {
    ...actual,
    PRF_INPUT_SALT: Promise.resolve(new Uint8Array(32)),
    getLinkedAccount: vi.fn(async () => ({
      server_user_id: 'user-1',
      base_url: 'https://srv.example',
      issuer_label: 'srv.example',
      role: 'user' as const,
      linked_at: new Date('2026-01-02T00:00:00Z'),
    })),
    addPasskeyPostLink: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/boot/open-db.js', () => ({ getDb: () => ({}) as IDBDatabase }));

vi.mock('../../src/lib/server-client.js', () => ({
  httpServerClient: { linkPasskeyStart: vi.fn() },
}));

import { addPasskeyPostLink } from '@chatsundere/crypto';
import { httpServerClient } from '../../src/lib/server-client.js';
import {
  StartUnreachableError,
  creationOptionsFromJSON,
  registerServerSyncedPasskey,
  serialiseRegistrationResponse,
} from '../../src/lib/server-passkey.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal but structurally valid attestation authenticatorData. */
function fakeAuthData(): ArrayBuffer {
  const ad = new Uint8Array(62);
  ad[32] = 0x40; // AT flag set
  ad[53] = 0x00;
  ad[54] = 0x03; // credentialId length = 3
  ad.set([9, 9, 9], 55); // credentialId bytes
  ad.set([0xa1, 0x01, 0x02, 0x03], 58); // COSE public key bytes
  return ad.buffer;
}

/** A fake PublicKeyCredential whose PRF result is present. */
function fakeCredential() {
  const create = vi.fn();
  const rawId = new Uint8Array([10, 20, 30]).buffer;
  const credential = {
    id: 'cred-id',
    rawId,
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    response: {
      clientDataJSON: new Uint8Array([1, 2]).buffer,
      attestationObject: new Uint8Array([3, 4]).buffer,
      getAuthenticatorData: () => fakeAuthData(),
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({
      prf: { results: { first: new Uint8Array(32).buffer } },
    }),
  };
  return { create, credential };
}

const startJson = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'Chatsundere', id: 'srv.example' },
  user: { id: 'dXNlci1pZA', name: 'casey', displayName: 'casey' },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  timeout: 60000,
  attestation: 'none' as const,
  authenticatorSelection: {
    userVerification: 'preferred' as const,
    residentKey: 'preferred' as const,
  },
};

// ─── Pure converters ──────────────────────────────────────────────────────────

describe('creationOptionsFromJSON', () => {
  it('decodes challenge and user.id, keeps rp/params, injects the PRF eval', () => {
    const prfSalt = new Uint8Array(32);
    const opts = creationOptionsFromJSON(startJson, prfSalt);
    expect(new TextDecoder().decode(opts.challenge as Uint8Array)).toBe('challenge');
    expect(new TextDecoder().decode(opts.user.id as Uint8Array)).toBe('user-id');
    expect(opts.rp.id).toBe('srv.example');
    expect(opts.pubKeyCredParams).toEqual(startJson.pubKeyCredParams);
    expect(opts.extensions?.prf?.eval?.first).toBeDefined();
  });
});

describe('serialiseRegistrationResponse', () => {
  it('round-trips a synthetic attestation into the JSON envelope', async () => {
    const { fromBase64Url } = await import('@chatsundere/crypto');
    const { credential } = fakeCredential();
    // biome-ignore lint/suspicious/noExplicitAny: fake credential stands in for the DOM type.
    const json = serialiseRegistrationResponse(credential as any);
    expect(json.type).toBe('public-key');
    expect(json.id).toBe('cred-id');
    expect(Array.from(fromBase64Url(json.rawId))).toEqual([10, 20, 30]);
    expect(Array.from(fromBase64Url(json.response.clientDataJSON))).toEqual([1, 2]);
    expect(Array.from(fromBase64Url(json.response.attestationObject))).toEqual([3, 4]);
    expect(json.response.transports).toEqual(['internal']);
  });
});

// ─── Fall-through behaviour ───────────────────────────────────────────────────

describe('registerServerSyncedPasskey fall-through (spec §11.1 / §14.4)', () => {
  let registerLocalBiometric: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // clearAllMocks resets call history but preserves the factory implementations
    // (getLinkedAccount still resolves the linked account defined above).
    vi.clearAllMocks();
    registerLocalBiometric = vi.fn(async () => undefined);
    const session = {
      accessToken: 'access-token',
      mode: 'linked',
      registerLocalBiometric,
    } as unknown as AppSession;
    useSessionStore.setState({ session, mk: new Uint8Array(32) as never });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useSessionStore.setState({ session: null, mk: null });
  });

  it('throws StartUnreachableError when linkPasskeyStart rejects, without minting a credential', async () => {
    const create = vi.fn();
    vi.stubGlobal('navigator', { credentials: { create } });
    vi.mocked(httpServerClient.linkPasskeyStart).mockRejectedValue(new Error('network'));

    await expect(registerServerSyncedPasskey('This device')).rejects.toBeInstanceOf(
      StartUnreachableError,
    );
    expect(create).not.toHaveBeenCalled();
    expect(registerLocalBiometric).not.toHaveBeenCalled();
    expect(addPasskeyPostLink).not.toHaveBeenCalled();
  });

  it("degrades to 'local-fallback' when addPasskeyPostLink rejects after creation", async () => {
    const { credential } = fakeCredential();
    const create = vi.fn(async () => credential);
    vi.stubGlobal('navigator', { credentials: { create } });
    vi.mocked(httpServerClient.linkPasskeyStart).mockResolvedValue({
      session_id: 'sess-1',
      options: startJson,
    });
    vi.mocked(addPasskeyPostLink).mockRejectedValue(new Error('server rejected'));

    const result = await registerServerSyncedPasskey('This device');

    expect(result).toBe('local-fallback');
    expect(create).toHaveBeenCalledTimes(1);
    expect(registerLocalBiometric).toHaveBeenCalledTimes(1);
    const call = registerLocalBiometric.mock.calls[0]?.[0] as { credentialId: Uint8Array };
    expect(Array.from(call.credentialId)).toEqual([10, 20, 30]);
  });
});
