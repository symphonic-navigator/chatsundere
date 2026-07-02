// SPDX-License-Identifier: AGPL-3.0-only

import { fromBase64Url, toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection, SyncPulledRecord, SyncPushResult } from '@chatsundere/shared-types';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as v from 'valibot';
import { publishPoke } from '../doorbell/publish.js';
import { authenticate } from '../http/authenticate.js';
import type { SyncDeps } from '../http/deps.js';
import {
  observePullLatency,
  observePushLatency,
  observeRecordSize,
  recordPull,
  recordPushOutcome,
} from '../metrics.js';
import {
  type StoreResult,
  type StoreWriteRecord,
  type StoredRecord,
  applyBatch,
  getHead,
  pullSince,
} from '../records/store.js';

const PushRecordSchema = v.strictObject({
  blindId: v.string(),
  collection: v.string(),
  envelopeVersion: v.number(),
  baseRev: v.number(),
  deleted: v.boolean(),
  nonce: v.optional(v.string()),
  ciphertext: v.optional(v.string()),
  ciphertextHash: v.optional(v.string()),
});
const PushBodySchema = v.strictObject({ records: v.array(PushRecordSchema) });

/** A 400 shape rejection with a machine-readable reason. */
class ShapeError extends Error {}

function decodeField(b64: string, expectedLen: number | null, label: string): Uint8Array {
  const bytes = fromBase64Url(b64);
  if (expectedLen !== null && bytes.length !== expectedLen) {
    throw new ShapeError(`${label} must decode to ${expectedLen} bytes`);
  }
  return bytes;
}

function toWire(r: StoredRecord): SyncPulledRecord {
  const base: SyncPulledRecord = {
    blindId: toBase64Url(r.blindId),
    collection: r.collection as SyncCollection,
    envelopeVersion: r.envelopeVersion,
    rev: r.rev,
    deleted: r.deleted,
  };
  if (r.deleted) return base;
  return {
    ...base,
    nonce: r.nonce ? toBase64Url(r.nonce) : undefined,
    ciphertext: r.ciphertext ? toBase64Url(r.ciphertext) : undefined,
    ciphertextHash: r.ciphertextHash ? toBase64Url(r.ciphertextHash) : undefined,
  };
}

function toWireResult(r: StoreResult): SyncPushResult {
  switch (r.status) {
    case 'ok':
      return { status: 'ok', rev: r.rev };
    case 'conflict':
      return { status: 'conflict', current: toWire(r.current) };
    case 'tombstoned':
      return { status: 'tombstoned', current: toWire(r.current) };
    case 'error':
      return { status: 'error', code: r.code, usedBytes: r.usedBytes, quotaBytes: r.quotaBytes };
  }
}

/** Decodes a validated push body into store records, enforcing decoded lengths. */
function toStoreRecords(body: v.InferOutput<typeof PushBodySchema>): StoreWriteRecord[] {
  return body.records.map((r) => {
    const blindId = decodeField(r.blindId, 16, 'blindId');
    if (r.deleted) {
      return {
        blindId,
        collection: r.collection,
        envelopeVersion: r.envelopeVersion,
        baseRev: r.baseRev,
        deleted: true,
      };
    }
    if (!r.nonce || !r.ciphertext || !r.ciphertextHash) {
      throw new ShapeError('a non-delete record must carry nonce, ciphertext and ciphertextHash');
    }
    return {
      blindId,
      collection: r.collection,
      envelopeVersion: r.envelopeVersion,
      baseRev: r.baseRev,
      deleted: false,
      nonce: decodeField(r.nonce, 12, 'nonce'),
      ciphertext: decodeField(r.ciphertext, null, 'ciphertext'),
      ciphertextHash: decodeField(r.ciphertextHash, 32, 'ciphertextHash'),
    };
  });
}

/** Registers the push and pull halves of `/api/v1/sync/changes`. */
export function registerChangesRoutes(app: Hono, deps: SyncDeps): void {
  const { env, db, redis, allow, epoch } = deps;

  app.post(
    '/api/v1/sync/changes',
    bodyLimit({
      maxSize: env.MAX_BODY_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'body_too_large', message: 'Request body too large' } }, 413),
    }),
    async (c) => {
      const auth = await authenticate(c, deps);
      if (!auth.ok) return auth.response;
      const sub = auth.claims.sub;

      let parsed: v.InferOutput<typeof PushBodySchema>;
      try {
        const raw = await c.req.json();
        parsed = v.parse(PushBodySchema, raw);
      } catch {
        return c.json({ error: { code: 'bad_request', message: 'Malformed body' } }, 400);
      }
      if (parsed.records.length > env.MAX_PUSH_RECORDS) {
        return c.json({ error: { code: 'bad_request', message: 'Too many records' } }, 400);
      }

      let records: StoreWriteRecord[];
      try {
        records = toStoreRecords(parsed);
      } catch (e) {
        if (e instanceof ShapeError)
          return c.json({ error: { code: 'bad_request', message: e.message } }, 400);
        throw e;
      }

      const started = performance.now();
      const deleteAllowance = async (count: number): Promise<number> => {
        let granted = 0;
        for (let i = 0; i < count; i++) {
          if (await allow(`del:${sub}`, env.RATE_LIMIT_DELETE_PER_MIN, 60)) granted += 1;
          else break;
        }
        return granted;
      };

      const { head, results, accepted } = await applyBatch(db, sub, records, {
        maxRecordBytes: env.MAX_RECORD_BYTES,
        quotaBytes: env.ACCOUNT_QUOTA_BYTES,
        deleteAllowance,
      });
      observePushLatency((performance.now() - started) / 1000);

      // Post-commit doorbell publish, once per accepted batch (spec §8.2).
      if (accepted) await publishPoke(redis, sub, head, epoch);

      for (let i = 0; i < results.length; i++) {
        const r = results[i] as StoreResult;
        recordPushOutcome(r.status === 'error' ? r.code : r.status);
        const rec = records[i];
        if (r.status === 'ok' && rec && !rec.deleted && rec.ciphertext)
          observeRecordSize(rec.ciphertext.length);
      }

      return c.json({ head, epoch, results: results.map(toWireResult) });
    },
  );

  app.get('/api/v1/sync/changes', async (c) => {
    const auth = await authenticate(c, deps);
    if (!auth.ok) return auth.response;
    const sub = auth.claims.sub;

    const sinceRaw = c.req.query('since') ?? '0';
    const since = Number(sinceRaw);
    if (!Number.isInteger(since) || since < 0) {
      return c.json(
        { error: { code: 'bad_request', message: 'since must be a non-negative integer' } },
        400,
      );
    }

    // Over-max limit clamps (never a 400); missing/invalid falls back to the default.
    const limitRaw = Number(c.req.query('limit'));
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, env.PULL_LIMIT_MAX)
        : env.PULL_LIMIT_DEFAULT;

    const head = await getHead(db, sub);
    if (since > head) {
      // A watermark ahead of head signals a reset the epoch rule (§12.2) catches.
      return c.json({ error: { code: 'bad_since', message: 'since is ahead of head' } }, 400);
    }

    const started = performance.now();
    const page = await pullSince(db, sub, since, limit, env.PULL_BYTE_BUDGET);
    observePullLatency((performance.now() - started) / 1000);
    recordPull(page.records.length);

    return c.json({ head: page.head, epoch, more: page.more, records: page.records.map(toWire) });
  });
}
