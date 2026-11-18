// SPDX-License-Identifier: AGPL-3.0-only
//
// REGRESSION TEST (fix/050-passkey-master-key, spec §5.2): a passkey unlock
// from a cold start hands the master key to the session store, exactly as the
// passphrase path does. Before the fix the store's raw `mk` slice stayed null,
// so the first thing a send does (the master-key check in `useSendMessage`)
// failed and the sync gate stayed shut.
//
// It drives the real chain end to end: a real local account
// (`createLocalAccount`), a real PRF-wrapped passkey row
// (`completeLocalBiometricRegistration`) bound to a real P-256 key, the real
// `Login` page and its `handleBiometricUnlock`, with only
// `navigator.credentials.get` replaced by a software authenticator that signs a
// genuine assertion and returns a PRF output. `loginWithLocalBiometric`
// verifies that assertion and unwraps the MK for real.

import {
  PRF_INPUT_SALT,
  asMasterKey,
  completeLocalBiometricRegistration,
  createLocalAccount,
} from '@chatsundere/crypto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import { _resetClientDataDbForTests } from '../../src/boot/client-data-db';
import { getClientDataDb } from '../../src/boot/client-data-db';
import { closeDb, getDb, openDb } from '../../src/boot/open-db';
import { useSendMessage } from '../../src/data/send-message';
import { sealSecret } from '../../src/lib/secrets';
import { Login } from '../../src/routes/login/index';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';
import { isClass2Allowed } from '../../src/sync/gate';
import {
  _resetTriggersForTests,
  _setTriggerCycle,
  initSyncTriggers,
} from '../../src/sync/triggers';

// JSDOM's structuredClone returns typed arrays whose ArrayBuffer belongs to
// another realm, so fake-indexeddb (which checks `instanceof ArrayBuffer`)
// rejects the binary `credential_id` key it stored itself with a DataError. A
// real browser has one realm. Re-root binary values into this realm after the
// clone (test-only shim, same pattern as tests/components/ImagePill.test.tsx).
{
  const orig = globalThis.structuredClone;
  const reroot = (v: unknown): unknown => {
    if (ArrayBuffer.isView(v) && !(v.buffer instanceof ArrayBuffer)) {
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
    }
    if (
      Object.prototype.toString.call(v) === '[object ArrayBuffer]' &&
      !(v instanceof ArrayBuffer)
    ) {
      return new Uint8Array(v as ArrayBuffer).slice().buffer;
    }
    if (Array.isArray(v)) return v.map(reroot);
    if (v && typeof v === 'object' && Object.getPrototypeOf(v)?.constructor?.name === 'Object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = reroot(o[k]);
    }
    return v;
  };
  globalThis.structuredClone = (<T,>(value: T, opts?: StructuredSerializeOptions): T =>
    reroot(orig(value, opts)) as T) as typeof structuredClone;
}

const CRYPTO_DB = 'chatsundere';
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
  const x = raw.slice(1, 33);
  const y = raw.slice(33, 65);
  return concat(
    Uint8Array.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Uint8Array.from([0x22, 0x58, 0x20]),
    y,
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

interface SoftAuthenticator {
  publicKeyCose: Uint8Array;
  /** The PRF output the next assertion returns; a test may swap it for a wrong one. */
  prfOutput: Uint8Array;
  get(options: CredentialRequestOptions): Promise<PublicKeyCredential>;
  calls: CredentialRequestOptions[];
}

async function makeSoftAuthenticator(): Promise<SoftAuthenticator> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  let counter = 0;
  const calls: CredentialRequestOptions[] = [];
  const authenticator: SoftAuthenticator = {
    publicKeyCose: coseEc2(raw),
    prfOutput: PRF_OUTPUT,
    calls,
    async get(options) {
      calls.push(options);
      const pk = options.publicKey;
      if (!pk) throw new Error('soft authenticator: publicKey options missing');
      const challenge = new Uint8Array(pk.challenge as Uint8Array);
      const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: b64url(challenge),
          origin: window.location.origin,
          crossOrigin: false,
        }),
      );
      counter += 1;
      const authenticatorData = concat(
        await sha256(new TextEncoder().encode(window.location.hostname)),
        Uint8Array.from([0x05]), // UP | UV
        Uint8Array.from(
          [counter >>> 24, counter >>> 16, counter >>> 8, counter].map((n) => n & 0xff),
        ),
      );
      const signed = concat(authenticatorData, await sha256(clientDataJSON));
      const rawSig = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          signed as Uint8Array<ArrayBuffer>,
        ),
      );
      const signature = rawSigToDer(rawSig);
      return {
        type: 'public-key',
        id: b64url(CREDENTIAL_ID),
        rawId: CREDENTIAL_ID.slice().buffer,
        response: {
          clientDataJSON: clientDataJSON.buffer,
          authenticatorData: authenticatorData.slice().buffer,
          signature: signature.slice().buffer,
          userHandle: null,
        },
        getClientExtensionResults: () => ({
          prf: { results: { first: authenticator.prfOutput.slice().buffer } },
        }),
      } as unknown as PublicKeyCredential;
    },
  };
  return authenticator;
}

// ─── Fixture: account + passkey + persona, then a "cold start" ────────────────

async function deleteCryptoDb(): Promise<void> {
  closeDb();
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase(CRYPTO_DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
}

async function setUpDeviceThenColdStart(auth: SoftAuthenticator) {
  await openDb();
  const db = getDb();
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

  // A persona whose provider key is sealed under this MK, so a send with the
  // MK present gets past context resolution.
  const cdb = getClientDataDb();
  const providerId = uuidv7();
  const personaId = uuidv7();
  const chatId = uuidv7();
  await cdb.providers.add({
    id: providerId,
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: nanoGpt.baseUrl,
    apiKey: await sealSecret('test-key', mk, `provider/${providerId}/api-key`),
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  const offering = nanoGpt.offerings[0];
  if (!offering) throw new Error('nano-gpt has no offerings');
  await cdb.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'instr',
    canonicalId: null,
    providerId,
    modelId: offering.upstreamSlug,
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });
  const settings = await cdb.settings.get(1);
  await cdb.chats.add({
    id: chatId,
    personaId,
    title: null,
    resolvedMindspaceId: settings?.defaultMindspaceId ?? 'mindspace',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });

  // Keep a private copy to compare against: close() zeroes the shared buffer.
  const mkCopy = asMasterKey(mk.slice());

  // Cold start: the in-memory store is empty, as after a reload (nothing of the
  // session is persisted, see protected-route.tsx).
  session.close();
  useSessionStore.setState({ session: null, mk: null });
  return { personaId, chatId, mkCopy };
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

async function attemptSend(personaId: string, chatId: string): Promise<unknown> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useSendMessage(), { wrapper: wrapper(qc) });
  let outcome: unknown = 'resolved';
  await act(async () => {
    try {
      await result.current.mutateAsync({
        chatId,
        personaId,
        text: 'Hello',
        reasoning: { kind: 'on' },
      });
    } catch (e) {
      outcome = e;
    }
  });
  return outcome;
}

function renderLogin(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/app" element={<p>app shell</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Render the Login page, press the passkey button and wait for the app shell. */
async function unlockWithPasskey(): Promise<void> {
  renderLogin();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with passkey' }));
  await screen.findByText('app shell', undefined, { timeout: 10_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Regression (fix/050): a passkey unlock after a cold start hands the MK to the store', () => {
  let auth: SoftAuthenticator;
  let startSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await deleteCryptoDb();
    await _resetClientDataDbForTests({ keepData: false });
    useSessionStore.setState({ session: null, mk: null });
    useAccountLinkStore.getState().setLocalOnly();
    sessionStorage.setItem('splashShown', '1');
    auth = await makeSoftAuthenticator();
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class {} });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: (o: CredentialRequestOptions) => auth.get(o) },
    });
    startSpy = vi.fn().mockResolvedValue(undefined);
    useStreamManagerStore.setState({ start: startSpy } as never);
  });

  afterEach(async () => {
    // Let activateSession's fire-and-forget housekeeping settle before the DBs go.
    await new Promise((r) => setTimeout(r, 50));
    _resetTriggersForTests();
    useSessionStore.getState().closeAndForget();
    useAccountLinkStore.getState().setLocalOnly();
    useConnectivityStore.getState().setState({ kind: 'local_offline' });
    await _resetClientDataDbForTests({ keepData: false });
    await deleteCryptoDb();
    vi.restoreAllMocks();
  });

  it('unlocks with the passkey button, sets the MK to the account MK, and a send reaches the stream manager', async () => {
    const { personaId, chatId, mkCopy } = await setUpDeviceThenColdStart(auth);

    await unlockWithPasskey();

    // The page asked for PRF with the app-wide salt: nothing about the salt changed.
    const prfFirst = (
      auth.calls[0]?.publicKey?.extensions as { prf?: { eval?: { first?: Uint8Array } } }
    )?.prf?.eval?.first;
    expect(prfFirst).toEqual((await PRF_INPUT_SALT).slice());

    const { session, mk } = useSessionStore.getState();
    expect(session?.username).toBe('alice');
    expect(mk).not.toBeNull();
    expect(Array.from(mk ?? [])).toEqual(Array.from(mkCopy));

    const outcome = await attemptSend(personaId, chatId);
    expect(outcome).toBe('resolved');
    expect(startSpy).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('shares one buffer between the session and the store, so closeAndForget zeroes it', async () => {
    await setUpDeviceThenColdStart(auth);
    await unlockWithPasskey();

    const held = useSessionStore.getState().mk;
    expect(held).not.toBeNull();
    useSessionStore.getState().closeAndForget();

    expect(held?.every((byte) => byte === 0)).toBe(true);
    expect(useSessionStore.getState()).toMatchObject({ session: null, mk: null });
  }, 30_000);

  it('a wrong PRF output shows the passkey-unlock error and activates no session', async () => {
    await setUpDeviceThenColdStart(auth);
    auth.prfOutput = new Uint8Array(32).fill(0x33);

    renderLogin();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with passkey' }));

    await screen.findByText('Could not verify with passkey. Try your passphrase.', undefined, {
      timeout: 10_000,
    });
    expect(screen.queryByText('app shell')).toBeNull();
    expect(useSessionStore.getState()).toMatchObject({ session: null, mk: null });
  }, 30_000);

  it('opens the sync gate on a linked account and fires exactly one cycle on unlock', async () => {
    await setUpDeviceThenColdStart(auth);
    useAccountLinkStore
      .getState()
      .setLinked({ base_url: 'https://s.example', issuer_label: 's.example', role: 'user' });
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
    const cycle = vi.fn((): Promise<void> => Promise.resolve());
    _setTriggerCycle(cycle);
    initSyncTriggers();
    expect(isClass2Allowed()).toBe(false);
    expect(cycle).not.toHaveBeenCalled();

    await unlockWithPasskey();

    expect(isClass2Allowed()).toBe(true);
    expect(cycle).toHaveBeenCalledTimes(1);
  }, 30_000);
});
