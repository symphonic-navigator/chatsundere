// apps/user-client/tests/lib/wipe-device.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useSessionStore } from '@chatsundere/ui-shared';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

// Best-effort session revoke (Task 5). Spied so we can both stub its result and
// assert the wipe called it — and that it ran BEFORE the in-memory key was
// zeroed (it needs the live bearer token).
const logoutSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/auth-logout.js', () => ({ logoutCurrentSession: logoutSpy }));

// Spy the two close-exports so we can pin the load-bearing ordering guarantee:
// every open handle is released BEFORE the completion-aware Dexie.delete runs.
// The spies delegate to the REAL close so the database is genuinely released
// (test 1 then observes the erase), while recording that it happened (test 2
// observes the order).
const closeClientSpy = vi.hoisted(() => vi.fn());
const closeVectorsSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/boot/client-data-db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/boot/client-data-db.js')>();
  return {
    ...actual,
    closeClientDataDb: () => {
      closeClientSpy();
      actual.closeClientDataDb();
    },
  };
});
vi.mock('../../src/boot/knowledge-vectors-db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/boot/knowledge-vectors-db.js')>();
  return {
    ...actual,
    closeKnowledgeVectorsDb: () => {
      closeVectorsSpy();
      actual.closeKnowledgeVectorsDb();
    },
  };
});

// Spy the boot-retained raw crypto handle's close-export. The crypto account DB
// ('chatsundere') carries the wrapped master key + local-account record; its
// handle lives in boot/open-db.ts, separate from the two Dexie handles, and MUST
// be released before `deleteRawDb('chatsundere')` runs — otherwise the delete
// blocks on the open handle and the crypto DB survives a device the user was told
// is erased. fake-indexeddb does not reproduce the browser's open-handle
// `onblocked`, so a naive "crypto DB survived" RED cannot fire; the load-bearing
// pin is the ordering spy below (closeDb runs BEFORE the raw crypto delete).
const closeCryptoSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/boot/open-db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/boot/open-db.js')>();
  return {
    ...actual,
    closeDb: () => {
      closeCryptoSpy();
      actual.closeDb();
    },
  };
});

const { wipeDevice } = await import('../../src/lib/wipe-device.js');

// Record the call order across the module boundary so we can assert
// close-before-delete deterministically.
let callLog: string[] = [];

// Wrap the real `Dexie.delete` so `callLog` also records the deletes
// themselves, not just the closes — otherwise a regression that moved a
// close to AFTER its delete would still pass, because the log had no marker
// for the delete to compare against. Captured and spied once at module init
// (before any test mutates it); `mockImplementation` is refreshed per test in
// `beforeEach` while still delegating to the real implementation so the
// databases are genuinely deleted (test 1 depends on that).
const originalDexieDelete = Dexie.delete.bind(Dexie);
const dexieDeleteSpy = vi.spyOn(Dexie, 'delete');

// Wrap the raw `indexedDB.deleteDatabase` so `callLog` records the crypto-DB
// delete too — the marker the ordering assertion compares `closeCrypto` against.
// We only record the crypto DB name ('chatsundere'); the two Dexie DBs have
// distinct names, and Dexie.delete internally routes through this same primitive,
// so filtering on the exact crypto name keeps their deletes out of this marker.
const originalDeleteDatabase = globalThis.indexedDB.deleteDatabase.bind(globalThis.indexedDB);
const rawDeleteSpy = vi.spyOn(globalThis.indexedDB, 'deleteDatabase');

let locationAssign: ReturnType<typeof vi.fn>;

// A minimal Map-backed Storage stub. The Vitest env's `localStorage` is the
// experimental Node one (unavailable without `--localstorage-file`), so we
// supply our own deterministic storage and restore it in afterEach.
function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

let localStorageStub: Storage;
let sessionStorageStub: Storage;

beforeEach(async () => {
  callLog = [];
  logoutSpy.mockReset();
  logoutSpy.mockImplementation(() => {
    callLog.push('logout');
    return Promise.resolve(true);
  });
  closeClientSpy.mockReset();
  closeClientSpy.mockImplementation(() => {
    callLog.push('closeClient');
  });
  closeVectorsSpy.mockReset();
  closeVectorsSpy.mockImplementation(() => {
    callLog.push('closeVectors');
  });
  closeCryptoSpy.mockReset();
  closeCryptoSpy.mockImplementation(() => {
    callLog.push('closeCrypto');
  });
  dexieDeleteSpy.mockReset();
  dexieDeleteSpy.mockImplementation((name: string) => {
    callLog.push(name === 'chatsundere_client_data' ? 'deleteClient' : 'deleteVectors');
    return originalDexieDelete(name);
  });
  rawDeleteSpy.mockReset();
  rawDeleteSpy.mockImplementation((name: string) => {
    if (name === 'chatsundere') callLog.push('deleteCrypto');
    return originalDeleteDatabase(name);
  });

  // A live in-memory session, so we can prove closeAndForget zeroed it.
  // `closeAndForget` calls `session.close()`, so the fixture supplies one.
  useSessionStore.setState({
    session: { userId: 'u1', close: () => {} } as never,
    mk: new Uint8Array([1, 2, 3]) as never,
  });

  // Populate the surfaces the wipe must clear.
  localStorageStub = makeStorageStub();
  sessionStorageStub = makeStorageStub();
  vi.stubGlobal('localStorage', localStorageStub);
  vi.stubGlobal('sessionStorage', sessionStorageStub);
  localStorageStub.setItem('draft', 'secret plaintext');
  sessionStorageStub.setItem('scratch', 'ephemeral');

  // Mock the terminal navigation so the test env does not actually navigate.
  locationAssign = vi.fn();
  vi.stubGlobal('location', { assign: locationAssign } as never);

  // Cache Storage + service worker are absent in jsdom/Node; the wipe must guard
  // for that. We assert those guards by leaving them undefined here.

  await _resetClientDataDbForTests();
  await openClientDataDb();
  const db = getClientDataDb();
  await db.personas.put({ id: 'p1', name: 'Fable' } as never);

  // `_resetClientDataDbForTests()` above calls the real `Dexie.delete` as
  // fixture setup (to isolate this test from the previous one), which our
  // spy also records. Clear the log again now that setup is done, so it
  // starts empty for the test body itself.
  callLog = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wipeDevice', () => {
  it('erases IndexedDB data, clears storage surfaces, revokes the session and navigates last', async () => {
    await wipeDevice();

    // The session's in-memory master key was zeroed.
    expect(useSessionStore.getState().mk).toBeNull();
    expect(useSessionStore.getState().session).toBeNull();

    // Best-effort logout was called (once), before the key was forgotten.
    expect(logoutSpy).toHaveBeenCalledTimes(1);

    // The client-data DB is gone: re-opening yields a fresh DB with no personas.
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    expect(await getClientDataDb().personas.count()).toBe(0);

    // Non-IndexedDB surfaces cleared.
    expect(localStorageStub.getItem('draft')).toBeNull();
    expect(sessionStorageStub.getItem('scratch')).toBeNull();

    // Navigation is the very last step.
    expect(locationAssign).toHaveBeenCalledWith('/onboarding');
  });

  it('closes every open handle BEFORE deleting (the surviving-persona fix)', async () => {
    await wipeDevice();

    // logout runs before the handles are closed (needs the bearer token); all
    // three close-exports — including `closeDb` for the boot-retained raw crypto
    // handle — run before the delete markers, pinning the close-before-delete
    // invariant itself, not merely that the closes happened. Without the
    // delete markers here, a regression moving a close to AFTER its delete would
    // still pass, because the log would look identical up to that point.
    expect(callLog).toEqual([
      'logout',
      'closeClient',
      'closeVectors',
      'closeCrypto',
      'deleteClient',
      'deleteVectors',
      'deleteCrypto',
    ]);
    expect(closeClientSpy).toHaveBeenCalledTimes(1);
    expect(closeVectorsSpy).toHaveBeenCalledTimes(1);
    expect(closeCryptoSpy).toHaveBeenCalledTimes(1);

    const closeClientIndex = callLog.indexOf('closeClient');
    const closeVectorsIndex = callLog.indexOf('closeVectors');
    const closeCryptoIndex = callLog.indexOf('closeCrypto');
    const deleteClientIndex = callLog.indexOf('deleteClient');
    const deleteVectorsIndex = callLog.indexOf('deleteVectors');
    const deleteCryptoIndex = callLog.indexOf('deleteCrypto');
    expect(closeClientIndex).toBeLessThan(deleteClientIndex);
    expect(closeVectorsIndex).toBeLessThan(deleteVectorsIndex);
    // The load-bearing pin for the HIGH: the crypto handle is released BEFORE the
    // raw crypto-DB delete, so the delete cannot block on an open handle.
    expect(closeCryptoIndex).toBeLessThan(deleteCryptoIndex);
  });
});
