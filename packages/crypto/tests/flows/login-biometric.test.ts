// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'bun:test';
import { openLocalDb } from '../../src/db/open.js';
import { getPasskeyCredential } from '../../src/db/passkey-credentials.js';
import { CryptoError } from '../../src/errors.js';
import { createLocalAccount } from '../../src/flows/create-local-account.js';
import { loginWithLocalBiometric } from '../../src/flows/login-biometric.js';
import { completeLocalBiometricRegistration } from '../../src/flows/setup-biometric.js';

const DB = 'chatsundere-test-login-biometric';
const ORIGIN = 'https://localhost';
const CREDENTIAL_ID = Uint8Array.from([0x0b, 0x5e, 0x12, 0x7a, 0x9c, 0x33, 0x01, 0xfe]);
const PRF_OUTPUT = new Uint8Array(32).fill(0x5a);

// ─── Software authenticator (ES256) ───────────────────────────────────────────

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

/** COSE_Key (EC2, P-256, ES256) as CBOR, from a raw 0x04||x||y public key. */
function coseEc2(raw: Uint8Array): Uint8Array {
  return concat(
    Uint8Array.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    raw.slice(1, 33),
    Uint8Array.from([0x22, 0x58, 0x20]),
    raw.slice(33, 65),
  );
}

/** WebCrypto yields r||s; WebAuthn ES256 signatures are DER sequences. */
function rawSigToDer(sig: Uint8Array): Uint8Array {
  const int = (b: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v: Uint8Array = b.slice(i);
    if ((v[0] ?? 0) & 0x80) v = concat(Uint8Array.from([0]), v);
    return concat(Uint8Array.from([0x02, v.length]), v);
  };
  const body = concat(int(sig.slice(0, 32)), int(sig.slice(32)));
  return concat(Uint8Array.from([0x30, body.length]), body);
}

interface Assertion {
  challenge: Uint8Array;
  clientDataJson: string;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
}

interface SoftAuthenticator {
  publicKeyCose: Uint8Array;
  assert(counter: number): Promise<Assertion>;
}

async function makeSoftAuthenticator(): Promise<SoftAuthenticator> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKeyCose: coseEc2(raw),
    async assert(counter) {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const clientDataJson = JSON.stringify({
        type: 'webauthn.get',
        challenge: b64url(challenge),
        origin: ORIGIN,
        crossOrigin: false,
      });
      const authenticatorData = concat(
        await sha256(new TextEncoder().encode(new URL(ORIGIN).hostname)),
        Uint8Array.from([0x05]), // UP | UV
        Uint8Array.from(
          [counter >>> 24, counter >>> 16, counter >>> 8, counter].map((n) => n & 0xff),
        ),
      );
      const signed = concat(
        authenticatorData,
        await sha256(new TextEncoder().encode(clientDataJson)),
      );
      const rawSig = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          signed as Uint8Array<ArrayBuffer>,
        ),
      );
      return { challenge, clientDataJson, authenticatorData, signature: rawSigToDer(rawSig) };
    },
  };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

async function setUp() {
  const db = await openLocalDb(DB);
  const auth = await makeSoftAuthenticator();
  const { session, mk } = await createLocalAccount({ db, username: 'alice', passphrase: 'pw' });
  await completeLocalBiometricRegistration({
    db,
    session,
    mk,
    credentialId: CREDENTIAL_ID,
    publicKey: auth.publicKeyCose,
    aaguid: null,
    prfOutput: PRF_OUTPUT,
    label: 'soft authenticator',
  });
  // A private copy: closing the account session zeroes the shared buffer.
  const accountMk = mk.slice();
  session.close();
  return { db, auth, accountMk };
}

async function storedCounter(db: IDBDatabase): Promise<number | undefined> {
  return (await getPasskeyCredential(db, CREDENTIAL_ID))?.sign_counter;
}

function loginArgs(db: IDBDatabase, a: Assertion, prfOutput: Uint8Array = PRF_OUTPUT) {
  return { db, credentialId: CREDENTIAL_ID, prfOutput, origin: ORIGIN, ...a };
}

describe('loginWithLocalBiometric', () => {
  it('returns { session, mk } with the account MK on a valid assertion', async () => {
    const { db, auth, accountMk } = await setUp();
    const result = await loginWithLocalBiometric(loginArgs(db, await auth.assert(1)));
    expect(result.session.username).toBe('alice');
    expect(result.mk).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.mk)).toEqual(Array.from(accountMk));
    result.session.close();
    db.close();
  });

  it('shares one buffer: session.close() zeroes the returned mk', async () => {
    const { db, auth } = await setUp();
    const { session, mk } = await loginWithLocalBiometric(loginArgs(db, await auth.assert(1)));
    expect(mk.some((b) => b !== 0)).toBe(true);
    session.close();
    expect(mk.every((b) => b === 0)).toBe(true);
    db.close();
  });

  it('rejects a wrong PRF output with integrity_check_failed and keeps the sign counter', async () => {
    const { db, auth } = await setUp();
    const before = await storedCounter(db);
    const err = await loginWithLocalBiometric(
      loginArgs(db, await auth.assert(1), new Uint8Array(32).fill(0x11)),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('integrity_check_failed');
    expect(await storedCounter(db)).toBe(before);
    db.close();
  });

  it('rejects a bad signature in verifyLocalAssertion and keeps the sign counter', async () => {
    const { db, auth } = await setUp();
    const before = await storedCounter(db);
    const a = await auth.assert(1);
    // A signature over different data: still well-formed DER, but invalid here.
    const other = await auth.assert(2);
    const err = await loginWithLocalBiometric(
      loginArgs(db, { ...a, signature: other.signature }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('webauthn_verification_failed');
    expect(await storedCounter(db)).toBe(before);
    db.close();
  });

  it('rejects an unknown credential with not_found', async () => {
    const { db, auth } = await setUp();
    const err = await loginWithLocalBiometric({
      ...loginArgs(db, await auth.assert(1)),
      credentialId: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe('not_found');
    db.close();
  });

  it('advances the stored sign counter on success', async () => {
    const { db, auth } = await setUp();
    expect(await storedCounter(db)).toBe(0);
    const first = await loginWithLocalBiometric(loginArgs(db, await auth.assert(3)));
    first.session.close();
    expect(await storedCounter(db)).toBe(3);
    const second = await loginWithLocalBiometric(loginArgs(db, await auth.assert(7)));
    second.session.close();
    expect(await storedCounter(db)).toBe(7);
    db.close();
  });
});
