// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { MasterKey, SealedRecord } from '@chatsundere/crypto';
import type { SyncCollection, SyncPullResponse, SyncPulledRecord } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrashRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  TOMBSTONE_CYCLE_CAP,
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  applyRecord,
  setInvalidator,
} from '../../src/sync/apply.js';
import { markDead } from '../../src/sync/dead-keys.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';
import { getSyncState } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setPullTransport, runPullLoop } from '../../src/sync/worker.js';
import { softDelete } from '../../src/trash/delete-flow.js';
import { listTrashCards, purgeCard, restoreCard } from '../../src/trash/trash-repo.js';

/**
 * Trashcan integration scenarios: five end-to-end paths driving the BUILT
 * repo/apply/throttle end-to-end — the real `softDelete` cascade collectors, the
 * real `restoreCard` new-identity restore, the real `runPullLoop` tombstone
 * throttle, and the real §7 `applyRecord` de-dup + durable H-1 anchor. Seeding
 * goes through production code wherever possible so a scenario exercises the same
 * paths a device does. A scenario failing here is a real feature bug, fixed in the
 * owning module — never by weakening the scenario.
 */

// ===== Fake crypto codec (deterministic, key-free — mirrors the sync harness) =====

const enc = new TextEncoder();
const dec = new TextDecoder();
/** No key material is used; the codec is deterministic on (collection, key, row). */
const DUMMY_MK = {} as MasterKey;

/** Deterministic blind-id bytes for a (collection, key) — matches every seam. */
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
  const row: unknown = JSON.parse(dec.decode(sealed.ciphertext));
  const rederived = toBase64Url(blindIdBytes(collection, extractKey(row)));
  if (rederived !== toBase64Url(blindId)) throw new Error('blind-id re-check mismatch');
  return row;
}

/** Build a pulled UPSERT wire record for a row keyed on its `id` (chats/personas/…). */
async function pulledUpsert(
  collection: SyncCollection,
  key: string,
  row: unknown,
  rev: number,
): Promise<SyncPulledRecord> {
  const sealed = await fakeSeal(DUMMY_MK, collection, key, row);
  return {
    blindId: toBase64Url(sealed.blindId),
    collection,
    envelopeVersion: 1,
    rev,
    deleted: false,
    nonce: toBase64Url(sealed.nonce),
    ciphertext: toBase64Url(sealed.ciphertext),
    ciphertextHash: toBase64Url(sealed.ciphertextHash),
  };
}

/** Build a pulled TOMBSTONE wire record (body-less) for a (collection, key). */
function pulledTombstone(collection: SyncCollection, key: string, rev: number): SyncPulledRecord {
  return { blindId: toBase64Url(blindIdBytes(collection, key)), collection, rev, deleted: true };
}

/** A `since`-aware pull transport: rev-ascending, everything above `since`; the
 *  client's per-cycle cap does the throttling, so `more` stays false. */
function scriptedPull(records: readonly SyncPulledRecord[], head: number) {
  return async (since: number, _limit: number): Promise<SyncPullResponse> => {
    const page = records.filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
    return { head, epoch: 'E1', more: false, records: page };
  };
}

// ===== Store seeding =====

/** Linked + reachable + unlocked → Class-2 writes allowed; discovery advertises sync. */
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

// ===== Live-row seeders (minimal shapes; casts mirror the sibling trash tests) =====

async function seedPersona(id: string): Promise<void> {
  await getClientDataDb().personas.put({
    id,
    name: `persona-${id}`,
    createdAt: 1,
    updatedAt: 1,
  } as never);
}
async function seedChat(id: string, personaId: string): Promise<void> {
  await getClientDataDb().chats.put({
    id,
    personaId,
    title: null,
    resolvedMindspaceId: 'ms-1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  } as never);
}
async function seedMessage(id: string, chatId: string): Promise<void> {
  await getClientDataDb().messages.put({
    id,
    chatId,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hi' }],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    kind: 'normal',
    streamingState: 'complete',
  } as never);
}
async function seedMemory(id: string, personaId: string): Promise<void> {
  await getClientDataDb().memoryJournal.put({
    id,
    personaId,
    content: `memory-${id}`,
    category: null,
    state: 'committed',
    isCorrection: false,
    createdAt: 1,
    committedAt: 1,
    autoCommitted: false,
    archivedByDreamId: null,
  } as never);
}

/** Seed a trashed card directly (device-B state), mirroring restore.test's seeder. */
function makeTrashRow(
  collection: SyncCollection,
  key: string,
  row: unknown,
  parentRef: { field: string; id: string } | null,
  entityKind: TrashRow['entityKind'],
  rootGroup: string,
): TrashRow {
  return {
    id: `${collection}:${key}`,
    collection,
    key,
    row,
    deletedAt: 1,
    purgeAt: Date.now() + 1_000_000,
    entityKind,
    rootGroup,
    parentRef,
  };
}

// ===== Lifecycle =====

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _setTriggerCycle(async () => undefined);
  setImmediateDrain(async () => undefined); // drain is a no-op; we assert on the outbox/trash
  _setApplyOpenRecord(fakeOpen);
  _setApplyComputeBlindId(async (_mk, c, k) => blindIdBytes(c, k));
  setInvalidator(() => undefined); // silence query invalidation in the pull loop
});

afterEach(async () => {
  _resetTriggersForTests();
  setImmediateDrain(async () => undefined);
  _resetApplyForTests();
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

// ===== Scenario 1 — delete persona → one card → restore =====

describe('Scenario 1 — a persona deletes to one card and restores under fresh ids', () => {
  it('folds the whole subtree into one card and restores it with remapped refs', async () => {
    await seedPersona('p1');
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    await seedMessage('m2', 'c1');
    await seedMemory('mem1', 'p1');
    const db = getClientDataDb();

    await softDelete('personas', 'p1');

    // ONE card — the persona root, with the chat and the memory folded in.
    const cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (!card) throw new Error('missing card');
    expect(card.cardKey).toBe('personas:p1');
    expect(card.entityKind).toBe('persona');
    expect(card.counts.chats).toBe(1);
    expect(card.counts.memories).toBe(1);

    await restoreCard('personas:p1');

    // The subtree is live again under NEW ids.
    const personas = await db.personas.toArray();
    const chats = await db.chats.toArray();
    const messages = await db.messages.toArray();
    const memories = await db.memoryJournal.toArray();
    expect(personas).toHaveLength(1);
    expect(chats).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(memories).toHaveLength(1);

    const persona = personas[0];
    const chat = chats[0];
    const memory = memories[0];
    if (!persona || !chat || !memory) throw new Error('missing restored row');
    expect(persona.id).not.toBe('p1');
    expect(chat.id).not.toBe('c1');

    // Foreign keys remapped to the NEW parent ids.
    expect(chat.personaId).toBe(persona.id);
    expect(memory.personaId).toBe(persona.id);
    for (const m of messages) expect(m.chatId).toBe(chat.id);

    // Fresh upsert outbox entries for every new id; trash cleared.
    const upserts = (await db.syncOutbox.toArray()).filter((r) => r.op === 'upsert');
    expect(new Set(upserts.map((r) => `${r.collection}:${r.key}`))).toEqual(
      new Set([
        `personas:${persona.id}`,
        `chats:${chat.id}`,
        `messages:${messages[0]?.id}`,
        `messages:${messages[1]?.id}`,
        `memoryJournal:${memory.id}`,
      ]),
    );
    expect(await db.trash.count()).toBe(0);
  });
});

// ===== Scenario 2 — delete chat, then its persona → the chat folds in =====

describe('Scenario 2 — a separately-deleted chat folds into its later-deleted persona', () => {
  it('renders one persona card and restore brings both persona and chat back', async () => {
    await seedPersona('p1');
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    const db = getClientDataDb();

    // Delete the chat first — while the persona is still live it is its own card.
    await softDelete('chats', 'c1');
    let cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardKey).toBe('chats:c1');

    // Now delete the persona: the chat's parentRef chain lifts it into the persona card.
    await softDelete('personas', 'p1');
    cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardKey).toBe('personas:p1');
    expect(cards[0]?.entityKind).toBe('persona');

    // Restoring the persona brings BOTH back, the chat re-parented to the new persona.
    await restoreCard('personas:p1');
    const personas = await db.personas.toArray();
    const chats = await db.chats.toArray();
    expect(personas).toHaveLength(1);
    expect(chats).toHaveLength(1);
    const persona = personas[0];
    const chat = chats[0];
    if (!persona || !chat) throw new Error('missing restored row');
    expect(chat.personaId).toBe(persona.id);
    expect(await db.messages.count()).toBe(1);
    expect(await db.trash.count()).toBe(0);
  });
});

// ===== Scenario 3 — > cap tombstones → throttled drain, grouped in trash =====

describe('Scenario 3 — a mass tombstone wave drains under the per-cycle cap, losing nothing', () => {
  it('applies at most the cap per cycle, holds the watermark, and groups the rest', async () => {
    const db = getClientDataDb();
    const total = TOMBSTONE_CYCLE_CAP + 50; // 250
    const baseRev = 100;
    const tombstones: SyncPulledRecord[] = [];
    for (let i = 0; i < total; i++) {
      const key = `c${i}`;
      await seedChat(key, 'pP');
      await db.syncRows.put({ collection: 'chats', key, rev: 1, ciphertextHash: `h${i}` });
      tombstones.push(pulledTombstone('chats', key, baseRev + i)); // revs 100..349
    }
    const highestRev = baseRev + total - 1; // 349
    const lowestDeferredRev = baseRev + TOMBSTONE_CYCLE_CAP; // rev of the (cap+1)th = 300
    _setPullTransport(scriptedPull(tombstones, highestRev));

    // Cycle 1: exactly the cap lands in trash; the watermark holds below the deferred tail.
    await runPullLoop();
    expect(await db.trash.count()).toBe(TOMBSTONE_CYCLE_CAP);
    expect((await getSyncState()).watermarkRev).toBe(lowestDeferredRev - 1); // 299

    // The landed rows carry grouping metadata (parentRef + rootGroup), not bare snapshots.
    const sample = await db.trash.get('chats:c0');
    expect(sample?.parentRef).toEqual({ field: 'personaId', id: 'pP' });
    expect(sample?.rootGroup).toBe('persona:pP');

    // Cycle 2: the deferred remainder drains — nothing lost.
    await runPullLoop();
    expect(await db.trash.count()).toBe(total);
    expect((await getSyncState()).watermarkRev).toBe(highestRev); // 349
    expect(await db.chats.count()).toBe(0); // every live row moved to trash
  });
});

// ===== Scenario 4 — cross-device restore de-dup (§3.7) =====

describe('Scenario 4 — a pulled restoredFrom upsert retires this device stale trash card', () => {
  it('retires only the matching card; a plain upsert leaves unrelated cards intact', async () => {
    const db = getClientDataDb();
    // Device-B state: two stale trash cards A already restored / never touched.
    await db.trash.bulkPut([
      makeTrashRow('chats', 'cX', { id: 'cX', personaId: 'pB' }, null, 'chat', 'chats:cX'),
      makeTrashRow('personas', 'pOther', { id: 'pOther' }, null, 'persona', 'persona:pOther'),
    ]);

    // A pulls cX's restored copy (new id, restoredFrom marker) → B retires trash['chats:cX'].
    const restored = await pulledUpsert(
      'chats',
      'cNew',
      { id: 'cNew', personaId: 'pB', title: null, createdAt: 1, restoredFrom: 'cX' },
      10,
    );
    expect(await applyRecord(restored)).toEqual({ kind: 'inserted' });
    expect(await db.trash.get('chats:cX')).toBeUndefined();
    expect(await db.trash.get('personas:pOther')).toBeDefined();

    // A plain upsert (no restoredFrom) retires nothing — the unrelated card survives.
    const plain = await pulledUpsert(
      'chats',
      'cZ',
      { id: 'cZ', personaId: 'pB', title: null, createdAt: 1 },
      11,
    );
    expect(await applyRecord(plain)).toEqual({ kind: 'inserted' });
    expect(await db.trash.get('personas:pOther')).toBeDefined();
  });
});

// ===== Scenario 5 — purge keeps the durable H-1 anchor =====

describe('Scenario 5 — purge drops snapshots but the dead-key anchor still trips H-1', () => {
  it('purges the card, retains dead-keys, and rejects a replayed upsert as tamper', async () => {
    await seedPersona('p1');
    await seedChat('c1', 'p1');
    await seedMessage('m1', 'c1');
    await seedMemory('mem1', 'p1');
    const db = getClientDataDb();

    await softDelete('personas', 'p1');
    // The server ack marks each cascade key dead (production applyOk → markDead);
    // the drain is a no-op in this harness, so replay that durable write here.
    for (const r of await db.trash.toArray()) await markDead(r.collection, r.key);

    await purgeCard('personas:p1');

    // Snapshots gone; the durable dead-key anchor survives the purge (§3.9).
    expect(await db.trash.count()).toBe(0);
    expect(await db.deadKeys.get('personas:p1')).toBeDefined();
    expect(await db.deadKeys.get('chats:c1')).toBeDefined();
    expect(await db.deadKeys.get('memoryJournal:mem1')).toBeDefined();

    // A malicious replay of a purged, no-longer-live key trips H-1 tamper.
    const replay = await pulledUpsert('chats', 'c1', { id: 'c1', personaId: 'p1' }, 999);
    expect(await db.chats.get('c1')).toBeUndefined();
    expect(await applyRecord(replay)).toEqual({ kind: 'tamper' });
    expect((await getSyncState()).attention).toEqual({ kind: 'tamper' });
  });
});
