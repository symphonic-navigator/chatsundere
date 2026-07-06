// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { MasterKey, SealedRecord } from '@chatsundere/crypto';
import type {
  SyncCollection,
  SyncPullResponse,
  SyncPulledRecord,
  SyncPushRecord,
  SyncPushResponse,
  SyncPushResult,
} from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import Dexie from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  getInertRejectionCount,
  setInvalidator,
  setSettingsNoteHook,
} from '../../src/sync/apply.js';
import {
  _resetRecoveryForTests,
  _setRecoveryPull,
  _setRecoverySleep,
  isEnginePaused,
  runRecovery,
} from '../../src/sync/recovery.js';
import { stripForSeal } from '../../src/sync/strip.js';
import { advanceWatermark, getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setOpenRecord,
  _setPullLoop,
  _setPullTransport,
  _setPushTransport,
  _setRecovery,
  drainOutbox,
  runPullLoop,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; these scenarios drive drain/pull/recovery, not that guard, so it
// is stubbed inert (no account linked → the guard never fires).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * WS-C Task 14 — adversarial sync integration scenarios (spec §14). These drive
 * the BUILT engine (`worker.ts` drain+pull, `apply.ts`, `recovery.ts`,
 * `resolution.ts`, `watermark.ts`) end-to-end against a scripted in-memory
 * server harness that can also MISBEHAVE. A scenario failing here is a real
 * engine bug, fixed in the owning module — never by weakening the scenario.
 *
 * ── Two-device model ────────────────────────────────────────────────────────
 * Two logical devices A and B share the harness's per-account record log. Each
 * device is a genuinely separate Dexie: {@link Device} owns its own
 * `fake-indexeddb` `IDBFactory` and, on `activate()`, swaps it into
 * `Dexie.dependencies.indexedDB` + `globalThis.indexedDB`, re-opens the client
 * DB against it, and re-seeds the (global, module-level) WS-0 stores + MK. Data
 * in each factory persists across switches, so A's local state survives while B
 * takes a turn.
 *
 * ── Fake crypto codec ───────────────────────────────────────────────────────
 * A deterministic, key-free codec shared by both devices (they hold the same
 * MK): `sealRecord` encodes the stripped row as UTF-8 JSON and sets
 * `ciphertextHash` to the REAL SHA-256 of that ciphertext — the property the
 * §7.0 echo shortcut depends on. `openRecord` JSON-decodes and re-checks the
 * blind id via `extractKey`, so a codec/blind-id failure surfaces as an inert
 * rejection exactly as the real primitive would.
 */

// ===== Fake crypto codec =====

const enc = new TextEncoder();
const dec = new TextDecoder();
/** No key material is used; the codec is deterministic on (collection, key, row). */
const DUMMY_MK = {} as MasterKey;

/** Deterministic blind id bytes for a (collection, key) — matches every seam. */
function blindIdBytes(collection: string, key: string): Uint8Array {
  return enc.encode(`bid:${collection}:${key}`);
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
}

/** Seal a row into a `SealedRecord` whose `ciphertextHash` is the true SHA-256. */
async function fakeSeal(
  _mk: MasterKey,
  collection: string,
  key: string,
  row: unknown,
): Promise<SealedRecord> {
  const ciphertext = enc.encode(JSON.stringify(row));
  const ciphertextHash = await sha256Bytes(ciphertext);
  return {
    blindId: blindIdBytes(collection, key),
    envelopeVersion: 1,
    nonce: new Uint8Array([0]),
    ciphertext,
    ciphertextHash,
  };
}

/** Open a sealed record: JSON-decode, then re-check the blind id via extractKey. */
async function fakeOpen(
  _mk: MasterKey,
  collection: string,
  blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  extractKey: (row: unknown) => string,
): Promise<unknown> {
  let row: unknown;
  try {
    row = JSON.parse(dec.decode(sealed.ciphertext));
  } catch {
    throw new Error('codec failure (undecryptable poison)');
  }
  const rederived = toBase64Url(blindIdBytes(collection, extractKey(row)));
  if (rederived !== toBase64Url(blindId)) throw new Error('blind-id re-check mismatch');
  return row;
}

// ===== The scripted server harness =====

interface StoredRecord {
  blindId: string;
  collection: SyncCollection;
  rev: number;
  deleted: boolean;
  nonce?: string;
  ciphertext?: string;
  ciphertextHash?: string;
}

/**
 * A scripted, rev-numbered per-account record log keyed by blindId, serving the
 * `/api/v1/sync/changes` GET (since/limit/more, monotone revs) and POST (assigns
 * revs; returns ok / conflict / tombstoned; head + epoch). Knobs let it
 * MISBEHAVE: flap the epoch, echo a page's records repeatedly, echo a wrong
 * hash, reorder a page below the watermark, replay an old ciphertext after a
 * tombstone, mass-tombstone, or serve an undecryptable poison record.
 */
class ScriptedServer {
  private readonly log = new Map<string, StoredRecord>();
  /** The last live upsert per blindId, kept so a tombstone can be "resurrected". */
  private readonly history = new Map<string, StoredRecord>();
  private revCounter = 0;

  private epochSeq = 1;
  /** When true, every authenticated response carries a fresh epoch (M-4). */
  epochFlap = false;
  /** Deliver each pulled record this many times in a page (echo storm, §7.0). */
  echoRepeat = 1;

  get head(): number {
    return this.revCounter;
  }

  private nextEpoch(): string {
    if (this.epochFlap) this.epochSeq += 1;
    return `E${this.epochSeq}`;
  }

  private toPulled(r: StoredRecord): SyncPulledRecord {
    if (r.deleted)
      return { blindId: r.blindId, collection: r.collection, rev: r.rev, deleted: true };
    return {
      blindId: r.blindId,
      collection: r.collection,
      envelopeVersion: 1,
      rev: r.rev,
      deleted: false,
      nonce: r.nonce,
      ciphertext: r.ciphertext,
      ciphertextHash: r.ciphertextHash,
    };
  }

  /** POST /changes — CAS per record; assigns monotone revs; returns head+epoch. */
  push(records: SyncPushRecord[]): SyncPushResponse {
    const results: SyncPushResult[] = [];
    for (const rec of records) {
      const cur = this.log.get(rec.blindId);
      const curRev = cur?.rev ?? 0;

      if (cur?.deleted && !rec.deleted) {
        // Pushing an upsert against a live tombstone — the key is dead (I-1).
        results.push({ status: 'tombstoned', current: this.toPulled(cur) });
        continue;
      }
      if (rec.baseRev !== curRev) {
        const current = cur
          ? this.toPulled(cur)
          : { blindId: rec.blindId, collection: rec.collection, rev: curRev, deleted: true };
        results.push({ status: 'conflict', current });
        continue;
      }

      const rev = ++this.revCounter;
      const stored: StoredRecord = {
        blindId: rec.blindId,
        collection: rec.collection,
        rev,
        deleted: rec.deleted,
        nonce: rec.nonce,
        ciphertext: rec.ciphertext,
        ciphertextHash: rec.ciphertextHash,
      };
      this.log.set(rec.blindId, stored);
      if (!rec.deleted) this.history.set(rec.blindId, stored);
      results.push({ status: 'ok', rev });
    }
    return { head: this.revCounter, epoch: this.nextEpoch(), results };
  }

  /** GET /changes?since&limit — records with rev > since, ascending, paged. */
  pull(since: number, limit: number): SyncPullResponse {
    let live = [...this.log.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
    if (this.echoRepeat > 1) {
      // Echo storm: re-deliver each record `echoRepeat` times in the page.
      live = live.flatMap((r) => Array.from({ length: this.echoRepeat }, () => r));
    }
    const more = live.length > limit;
    const page = live.slice(0, limit).map((r) => this.toPulled(r));
    return { head: this.revCounter, epoch: this.nextEpoch(), more, records: page };
  }

  // --- Misbehaviour knobs -----------------------------------------------------

  /** Seal a row and store it at a chosen rev (a scripted "other device" write). */
  async inject(collection: SyncCollection, key: string, row: unknown, rev: number): Promise<void> {
    this.revCounter = Math.max(this.revCounter, rev);
    const sealed = await fakeSeal(DUMMY_MK, collection, key, stripForSeal(collection, row));
    const stored: StoredRecord = {
      blindId: toBase64Url(sealed.blindId),
      collection,
      rev,
      deleted: false,
      nonce: toBase64Url(sealed.nonce),
      ciphertext: toBase64Url(sealed.ciphertext),
      ciphertextHash: toBase64Url(sealed.ciphertextHash),
    };
    this.log.set(stored.blindId, stored);
    this.history.set(stored.blindId, stored);
  }

  /** Store an undecryptable poison record for a key at a chosen rev (M-1). */
  injectPoison(collection: SyncCollection, key: string, rev: number): void {
    this.revCounter = Math.max(this.revCounter, rev);
    const blindId = toBase64Url(blindIdBytes(collection, key));
    this.log.set(blindId, {
      blindId,
      collection,
      rev,
      deleted: false,
      nonce: toBase64Url(new Uint8Array([0])),
      ciphertext: toBase64Url(enc.encode('<<not valid json — poison>>')),
      ciphertextHash: toBase64Url(new Uint8Array([1, 2, 3])),
    });
  }

  /** Re-deliver a key's pre-tombstone upsert ciphertext at a fresh rev (H-1). */
  replayUpsertAfterTombstone(collection: SyncCollection, key: string): void {
    const blindId = toBase64Url(blindIdBytes(collection, key));
    const hist = this.history.get(blindId);
    if (!hist) throw new Error(`no history to replay for ${collection}:${key}`);
    const rev = ++this.revCounter;
    this.log.set(blindId, { ...hist, rev, deleted: false });
  }

  /** Current rev of a key, for assertions. */
  revOf(collection: SyncCollection, key: string): number {
    return this.log.get(toBase64Url(blindIdBytes(collection, key)))?.rev ?? 0;
  }

  /** Whether the server's live record for a key currently decodes (poison check). */
  isDecodable(collection: SyncCollection, key: string): boolean {
    const stored = this.log.get(toBase64Url(blindIdBytes(collection, key)));
    if (!stored?.ciphertext) return false;
    try {
      JSON.parse(dec.decode(fromB64(stored.ciphertext)));
      return true;
    } catch {
      return false;
    }
  }
}

/** Local base64url → bytes for the harness's own decode check (avoids a dep cycle). */
function fromB64(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ===== Device abstraction (a separate Dexie per logical device) =====

class Device {
  readonly factory = new IDBFactory();

  /** Make this device's Dexie the live one; re-seed the global WS-0 stores + MK. */
  async activate(): Promise<void> {
    // biome-ignore lint/suspicious/noExplicitAny: swap Dexie's fake factory to this device's.
    Dexie.dependencies.indexedDB = this.factory as any;
    // biome-ignore lint/suspicious/noExplicitAny: swap the global fake factory to match.
    (globalThis as any).indexedDB = this.factory;
    await _resetClientDataDbForTests({ keepData: true }); // close the handle; KEEP this factory's data
    await openClientDataDb();
    seedLinkedOnline();
  }
}

// ===== Store seeding =====

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial discovery-config shape for the test.
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: DUMMY_MK as never });
}

/** Point every engine seam at the shared harness + the fake codec. */
function wireEngine(server: ScriptedServer): void {
  _setCryptoDeps({ computeBlindId: async (_mk, c, k) => blindIdBytes(c, k), sealRecord: fakeSeal });
  _setOpenRecord(fakeOpen);
  _setApplyOpenRecord(fakeOpen);
  _setApplyComputeBlindId(async (_mk, c, k) => blindIdBytes(c, k));
  _setPushTransport(async (records) => server.push(records));
  _setPullTransport(async (since, limit) => server.pull(since, limit));
  _setRecoveryPull(async (since, limit) => server.pull(since, limit));
  _setRecoverySleep(async () => undefined); // no real backoff sleep in tests
  _setPullLoop(runPullLoop); // the cycle's pull half (reset() nulls it to a no-op)
  _setRecovery(runRecovery); // the cycle's recovery half (wired by triggers in prod)
}

/** Enqueue a Class-1/2 outbox entry on the live device (mirrors a write site). */
async function enqueue(
  collection: SyncCollection,
  key: string,
  op: 'upsert' | 'delete',
): Promise<void> {
  await getClientDataDb().syncOutbox.add({ collection, key, op, enqueuedAt: Date.now() });
}

// ===== Lifecycle =====

let server: ScriptedServer;

beforeEach(() => {
  server = new ScriptedServer();
  wireEngine(server);
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetApplyForTests();
  _resetRecoveryForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== Scenario 1 — A-edits → B-pulls happy path (spec §14) =====

describe('Scenario 1 — A edits, B pulls, and a later A edit converges on B', () => {
  it('propagates a create, an insert on B, and a subsequent edit both ways', async () => {
    const A = new Device();
    const B = new Device();

    // A creates + edits a record, then drains.
    await A.activate();
    const dbA = getClientDataDb();
    await dbA.personas.put({ id: 'p1', name: 'A-first', updatedAt: 1000 } as never);
    await enqueue('personas', 'p1', 'upsert');
    await dbA.personas.update('p1', { name: 'A-edited', updatedAt: 1500 });
    await enqueue('personas', 'p1', 'upsert'); // coalesces with the first — one seal of the live row
    await drainOutbox();
    expect(server.revOf('personas', 'p1')).toBe(1);

    // B pulls (through the real cycle — empty outbox, doorbell-poked) and sees it.
    await B.activate();
    await runSyncCycle();
    const bP1 = (await getClientDataDb().personas.get('p1')) as { name: string } | undefined;
    expect(bP1).toMatchObject({ name: 'A-edited' });
    expect((await getSyncState()).watermarkRev).toBe(1);

    // A edits again; B pulls again → converges on the newest value.
    await A.activate();
    await getClientDataDb().personas.update('p1', { name: 'A-second', updatedAt: 3000 });
    await enqueue('personas', 'p1', 'upsert');
    await runSyncCycle();
    expect(server.revOf('personas', 'p1')).toBe(2);

    await B.activate();
    await runSyncCycle();
    const bP1b = (await getClientDataDb().personas.get('p1')) as { name: string } | undefined;
    expect(bP1b).toMatchObject({ name: 'A-second' });
    expect((await getSyncState()).watermarkRev).toBe(2);
  });
});

// ===== Scenario 2 — echo storm (spec §7.0, L-2) =====

describe('Scenario 2 — echo storm applies as idempotent no-ops', () => {
  it('re-delivered own writes echo (rev adopted, no data churn)', async () => {
    const A = new Device();
    await A.activate();
    const db = getClientDataDb();

    await db.personas.put({ id: 'p1', name: 'stable', updatedAt: 1000 } as never);
    await enqueue('personas', 'p1', 'upsert');
    await drainOutbox(); // server rev 1; syncRows records the local ciphertext hash
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(1);

    // The malicious server re-numbers our record to rev 8 and re-delivers it 5×.
    await server.inject('personas', 'p1', { id: 'p1', name: 'stable', updatedAt: 1000 }, 8);
    server.echoRepeat = 5;
    const before = getInertRejectionCount();
    const invalidate = vi.fn();
    setInvalidator(invalidate);

    await runPullLoop();

    // No data churn: the row is byte-identical, no invalidation fired, no rejection.
    const after = (await db.personas.get('p1')) as { name: string; updatedAt: number };
    expect(after).toMatchObject({ name: 'stable', updatedAt: 1000 });
    expect(invalidate).not.toHaveBeenCalled();
    expect(getInertRejectionCount()).toBe(before);
    // The rev is adopted (CAS base tracks the server numbering); no re-push queued.
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(8);
    expect(await db.syncOutbox.count()).toBe(0);
    expect((await getSyncState()).watermarkRev).toBe(8);
  });

  it('does NOT treat a record as echo when only the SERVER-echoed hash matches', async () => {
    const A = new Device();
    await A.activate();
    const db = getClientDataDb();

    await db.personas.put({ id: 'p1', name: 'orig', updatedAt: 1000 } as never);
    await enqueue('personas', 'p1', 'upsert');
    await drainOutbox();
    const storedHash = (await db.syncRows.get(['personas', 'p1']))?.ciphertextHash;
    expect(storedHash).toBeTruthy();

    // The server delivers DIFFERENT bytes (a newer row) but lies that the
    // ciphertextHash equals our stored one — the §7.0 local-hash guard must win.
    const blindId = toBase64Url(blindIdBytes('personas', 'p1'));
    const sealed = await fakeSeal(DUMMY_MK, 'personas', 'p1', {
      id: 'p1',
      name: 'server-newer',
      updatedAt: 5000,
    });
    _setPullTransport(async () => ({
      head: 9,
      epoch: 'E1',
      more: false,
      records: [
        {
          blindId,
          collection: 'personas',
          rev: 9,
          deleted: false,
          nonce: toBase64Url(sealed.nonce),
          ciphertext: toBase64Url(sealed.ciphertext),
          ciphertextHash: storedHash, // the lie
        },
      ],
    }));

    await runPullLoop();

    // Processed as a genuine conflict (pulled wins LWW) — never short-circuited.
    const after = (await db.personas.get('p1')) as { name: string };
    expect(after).toMatchObject({ name: 'server-newer' });
  });
});

// ===== Scenario 3 — tombstone-then-resurrect (H-1) =====

describe('Scenario 3 — tombstone-then-resurrect is rejected inertly (H-1)', () => {
  it('routes B to trash, then rejects a replayed upsert with the trash intact', async () => {
    const A = new Device();
    const B = new Device();

    // A creates a chat and drains.
    await A.activate();
    await getClientDataDb().chats.put({
      id: 'c1',
      title: 'real',
      createdAt: 1,
      updatedAt: 1000,
    } as never);
    await enqueue('chats', 'c1', 'upsert');
    await drainOutbox();

    // B pulls it.
    await B.activate();
    await runSyncCycle();
    expect(await getClientDataDb().chats.get('c1')).toBeDefined();

    // A deletes the chat and drains → the server tombstones the key.
    await A.activate();
    await getClientDataDb().chats.delete('c1');
    await enqueue('chats', 'c1', 'delete');
    await drainOutbox();

    // B pulls the tombstone → the row moves to trash.
    await B.activate();
    await runSyncCycle();
    const dbB = getClientDataDb();
    expect(await dbB.chats.get('c1')).toBeUndefined();
    expect(await dbB.trash.get('chats:c1')).toBeDefined();

    // The malicious server replays the pre-tombstone ciphertext at a fresh rev.
    server.replayUpsertAfterTombstone('chats', 'c1');
    await runSyncCycle();

    // H-1: the resurrection is rejected inertly — trash intact, no row, tamper raised.
    expect(await dbB.chats.get('c1')).toBeUndefined();
    expect(await dbB.trash.get('chats:c1')).toBeDefined();
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });
});

// ===== Scenario 4 — epoch flap trips the recovery rate limit (M-4) =====

describe('Scenario 4 — an epoch-flapping server pauses recovery (does not loop)', () => {
  it('stops with recovery_paused after more than 2 recoveries within the hour', async () => {
    const A = new Device();
    await A.activate();
    const db = getClientDataDb();

    // Establish the first-synced epoch on a stable server.
    await db.personas.put({ id: 'p1', name: 'x', updatedAt: 1000 } as never);
    await enqueue('personas', 'p1', 'upsert');
    await runSyncCycle();
    expect((await getSyncState()).epoch).toBe('E1');

    // Now the server flaps its epoch on every authenticated response.
    server.epochFlap = true;

    // Each cycle re-enqueues an edit so the drain pushes, reads a fresh (mismatched)
    // epoch, and hands off to recovery. The third recovery within the hour trips M-4.
    for (let i = 0; i < 3; i++) {
      await db.personas.update('p1', { updatedAt: 2000 + i });
      await enqueue('personas', 'p1', 'upsert');
      await runSyncCycle();
    }

    expect(isEnginePaused()).toBe(true);
    expect((await getSyncState()).attention).toEqual({ kind: 'recovery_paused' });
  });
});

// ===== Scenario 5 — watermark-regression page (M-7) =====

describe('Scenario 5 — a maliciously ordered low-rev page does not regress the watermark', () => {
  it('keeps the watermark when a page ignores `since` and serves lower revs', async () => {
    const B = new Device();
    await B.activate();
    await advanceWatermark(100);

    // The malicious server ignores `since=100` and serves a record at rev 5,
    // ordered so the page's last (and only) rev is below the watermark.
    _setPullTransport(async () => ({
      head: 100,
      epoch: 'E1',
      more: false,
      records: [
        {
          blindId: toBase64Url(blindIdBytes('chats', 'old')),
          collection: 'chats',
          rev: 5,
          deleted: true,
        },
      ],
    }));

    await runPullLoop();

    expect((await getSyncState()).watermarkRev).toBe(100); // clamped by max() — never regressed
  });
});

// ===== Scenario 6 — poison-conflict heal (M-1) =====

describe('Scenario 6 — a poison conflict heals via CAS-base adoption + re-push', () => {
  it('adopts the returned rev and re-pushes the good copy without wedging', async () => {
    const A = new Device();
    await A.activate();
    const db = getClientDataDb();

    // A holds a good local row with a stale CAS base (rev 1).
    await db.personas.put({ id: 'p1', name: 'A-good', updatedAt: 1000 } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: 'stale' });
    await enqueue('personas', 'p1', 'upsert');

    // The server's current record for p1 is an undecryptable poison at rev 12.
    server.injectPoison('personas', 'p1', 12);
    expect(server.isDecodable('personas', 'p1')).toBe(false);

    // First drain: baseRev 1 ≠ server rev 12 → conflict; current is poison → adopt
    // rev 12 as the new CAS base (the heal), keeping the entry for the re-push. (A
    // piggyback pull is separately owed — server head 12 > watermark 0 — but that
    // is orthogonal to the poison heal, which is a CAS-metadata adoption, M-1.)
    await drainOutbox();
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(12);
    expect(await db.syncOutbox.count()).toBe(1); // entry kept for the re-push

    // Second drain: baseRev 12 now matches → the good copy overwrites the poison.
    await drainOutbox();
    expect(server.isDecodable('personas', 'p1')).toBe(true); // healed
    expect(await db.syncOutbox.count()).toBe(0);
    expect((await db.syncRows.get(['personas', 'p1']))?.rev).toBe(13);
  });
});

// ===== Scenario 7 — settings replay (M-8) =====

describe('Scenario 7 — a replayed older settings blob does not roll settings back', () => {
  it('keeps the newer local settings, re-pushes, and notes precedence (not applied)', async () => {
    const B = new Device();
    await B.activate();
    const db = getClientDataDb();

    // B's local settings are strictly newer knowledge (updatedAt 2000).
    await db.settings.put({ id: 1, updatedAt: 2000, displayName: 'newer' } as never);
    await db.syncRows.put({ collection: 'settings', key: '1', rev: 5, ciphertextHash: 'stored' });

    const notes: string[] = [];
    setSettingsNoteHook((note) => notes.push(note));

    // The server replays an OLDER settings blob (updatedAt 1000) at a higher rev.
    await server.inject('settings', '1', { id: '1', updatedAt: 1000, displayName: 'older' }, 6);

    await runPullLoop();

    // The replay guard kept the newer local settings — NOT rolled back to 1000.
    const settings = (await db.settings.get(1)) as unknown as {
      updatedAt: number;
      displayName: string;
    };
    expect(settings.updatedAt).toBe(2000);
    expect(settings.displayName).toBe('newer');
    // The CAS base is adopted and a re-push is queued so the server re-converges.
    expect((await db.syncRows.get(['settings', '1']))?.rev).toBe(6);
    const repush = await db.syncOutbox
      .where('[collection+key]')
      .equals(['settings', '1'])
      .toArray();
    expect(repush).toHaveLength(1);
    // The two-tier note is "precedence" (this device's newer value won), never a
    // benign "applied" that would legitimise the rollback.
    expect(notes).toContain('settings-precedence');
    expect(notes).not.toContain('settings-applied');

    // Draining the re-push carries the newer settings up to the server.
    await drainOutbox();
    expect(server.revOf('settings', '1')).toBeGreaterThan(6);
  });
});
