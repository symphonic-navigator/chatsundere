// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, type SealedRecord, fromBase64Url, toBase64Url } from '@chatsundere/crypto';
import type {
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type McpOAuthGrantRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { QK } from '../../src/data/queryKeys.js';
import {
  _resetApplyForTests,
  _setApplyComputeBlindId,
  _setApplyOpenRecord,
  setInvalidator,
} from '../../src/sync/apply.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setOpenRecord,
  _setPullTransport,
  _setPushTransport,
  drainOutbox,
  runPullLoop,
} from '../../src/sync/worker.js';

vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * Outbox acknowledgements of OAuth grants (MCP OAuth hardening spec §5.2): the
 * drain carries the row's generation unchanged and its `ok` clears a hold the
 * pushed generation is entitled to clear. Driven through the real drain and pull
 * against a small compare-and-set server with a JSON codec.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const DUMMY_MK = {} as MasterKey;
const KEY = 'srv-1';

function blindIdBytes(collection: string, key: string): Uint8Array {
  return enc.encode(`bid:${collection}:${key}`);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function jsonSeal(
  _mk: MasterKey,
  collection: string,
  key: string,
  row: unknown,
): Promise<SealedRecord> {
  const ciphertext = enc.encode(JSON.stringify(row));
  return {
    blindId: blindIdBytes(collection, key),
    envelopeVersion: 1,
    nonce: new Uint8Array([0]),
    ciphertext,
    ciphertextHash: await sha256(ciphertext),
  };
}

async function jsonOpen(
  _mk: MasterKey,
  _collection: string,
  _blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
): Promise<unknown> {
  return JSON.parse(dec.decode(sealed.ciphertext));
}

/** A compare-and-set record log; `loseNextAck` stores a push and then fails the request. */
class CasServer {
  readonly log = new Map<string, SyncPulledRecord>();
  readonly pushed: SyncPushRecord[] = [];
  rev = 0;
  loseNextAck = false;

  push(records: SyncPushRecord[]): SyncPushResponse {
    const results: SyncPushResult[] = [];
    for (const rec of records) {
      this.pushed.push(rec);
      const cur = this.log.get(rec.blindId);
      if (rec.baseRev !== (cur?.rev ?? 0)) {
        results.push({
          status: 'conflict',
          current: cur ?? {
            blindId: rec.blindId,
            collection: rec.collection,
            rev: 0,
            deleted: true,
          },
        });
        continue;
      }
      this.rev += 1;
      this.log.set(rec.blindId, {
        blindId: rec.blindId,
        collection: rec.collection,
        envelopeVersion: 1,
        rev: this.rev,
        deleted: false,
        nonce: rec.nonce,
        ciphertext: rec.ciphertext,
        ciphertextHash: rec.ciphertextHash,
      });
      results.push({ status: 'ok', rev: this.rev });
    }
    if (this.loseNextAck) {
      this.loseNextAck = false;
      throw new TypeError('Failed to fetch');
    }
    return { head: this.rev, epoch: 'E1', results };
  }

  pull(since: number): SyncPullResponse {
    const records = [...this.log.values()].filter((r) => r.rev > since);
    return { head: this.rev, epoch: 'E1', more: false, records };
  }

  /** Seeds the server's record at a chosen revision. */
  async seed(row: McpOAuthGrantRow, rev: number): Promise<void> {
    const sealed = await jsonSeal(DUMMY_MK, 'mcpOAuthGrants', row.id, row);
    this.rev = Math.max(this.rev, rev);
    const blindId = toBase64Url(sealed.blindId);
    this.log.set(blindId, {
      blindId,
      collection: 'mcpOAuthGrants',
      envelopeVersion: 1,
      rev,
      deleted: false,
      nonce: toBase64Url(sealed.nonce),
      ciphertext: toBase64Url(sealed.ciphertext),
      ciphertextHash: toBase64Url(sealed.ciphertextHash),
    });
  }
}

function grant(overrides: Partial<McpOAuthGrantRow> = {}): McpOAuthGrantRow {
  return {
    id: KEY,
    resource: 'https://mcp.example/mcp',
    issuer: 'https://auth.example',
    tokenEndpoint: 'https://auth.example/token',
    revocationEndpoint: null,
    clientId: 'client-1',
    registration: 'dcr',
    scope: null,
    tokenRoute: 'direct',
    tokens: null,
    claim: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function sealedBody(rec: SyncPushRecord | undefined): Record<string, unknown> {
  if (!rec?.ciphertext) throw new Error('no sealed body');
  return JSON.parse(dec.decode(fromBase64Url(rec.ciphertext))) as Record<string, unknown>;
}

async function enqueueGrant(): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    collection: 'mcpOAuthGrants',
    key: KEY,
    op: 'upsert',
    enqueuedAt: Date.now(),
  });
}

let server: CasServer;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial discovery-config shape for the test.
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: DUMMY_MK as never });
  server = new CasServer();
  _setCryptoDeps({ computeBlindId: async (_mk, c, k) => blindIdBytes(c, k), sealRecord: jsonSeal });
  _setOpenRecord(jsonOpen);
  _setApplyOpenRecord(jsonOpen);
  _setApplyComputeBlindId(async (_mk, c, k) => blindIdBytes(c, k));
  _setPushTransport(async (records) => server.push(records));
  _setPullTransport(async (since) => server.pull(since));
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('outbox acknowledgement of a grant', () => {
  it('an outbox ack at or above seen clears the hold, carrying the generation unchanged', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant({ generation: 9, seenGeneration: 9, heldGeneration: 4 }));
    await enqueueGrant();

    await drainOutbox();

    const body = sealedBody(server.pushed[0]);
    expect(body.generation).toBe(9);
    expect('seenGeneration' in body).toBe(false);
    expect('heldGeneration' in body).toBe(false);
    const row = await db.mcpOAuthGrants.get(KEY);
    expect(row?.heldGeneration).toBeNull();
    expect(row?.seenGeneration).toBe(9);
    expect(row?.generation).toBe(9);
  });

  it('an outbox ack below seen changes nothing', async () => {
    const db = getClientDataDb();
    const local = grant({ generation: 4, seenGeneration: 9, heldGeneration: 4 });
    await db.mcpOAuthGrants.put(local);
    await enqueueGrant();

    await drainOutbox();

    expect(sealedBody(server.pushed[0]).generation).toBe(4);
    expect(await db.mcpOAuthGrants.get(KEY)).toEqual(local);
  });

  it('an outbox ack that clears a hold refreshes the grants query', async () => {
    const db = getClientDataDb();
    await db.mcpOAuthGrants.put(grant({ generation: 9, seenGeneration: 9, heldGeneration: 4 }));
    await enqueueGrant();
    const flushed: (readonly unknown[])[] = [];
    setInvalidator((keys) => flushed.push(...keys));

    await drainOutbox();

    expect(flushed).toContainEqual(QK.mcpOAuthGrants);
  });

  it('an ordinary drain conflict with our own lost-ack record applies and pushes cleanly', async () => {
    const db = getClientDataDb();
    await server.seed(grant({ generation: 3 }), 5);
    await db.mcpOAuthGrants.put(grant({ generation: 9, seenGeneration: 9, heldGeneration: 4 }));
    await db.syncRows.put({
      collection: 'mcpOAuthGrants',
      key: KEY,
      rev: 5,
      ciphertextHash: 'old',
    });
    await enqueueGrant();

    // The server stores our record at rev 6, but its acknowledgement never arrives.
    server.loseNextAck = true;
    await expect(drainOutbox()).rejects.toThrow();
    expect(await db.syncOutbox.count()).toBe(1);

    // The retry conflicts against our own record and owes a pull.
    const retry = await drainOutbox();
    expect(retry.needsPull).toBe(true);
    expect(server.pushed.at(-1)?.baseRev).toBe(5);

    await runPullLoop();
    const pulled = await db.mcpOAuthGrants.get(KEY);
    expect(pulled?.heldGeneration).toBeNull();
    expect(pulled?.seenGeneration).toBe(9);
    expect((await db.syncRows.get(['mcpOAuthGrants', KEY]))?.rev).toBe(6);

    const last = await drainOutbox();
    expect(server.pushed.at(-1)?.baseRev).toBe(6);
    expect(last.pushedHighestRev).toBe(7);
    expect(await db.syncOutbox.count()).toBe(0);
  });
});
