// SPDX-License-Identifier: AGPL-3.0-only
import { encodeRow, toBase64Url } from '@chatsundere/crypto';
import type { SyncCollection } from '@chatsundere/shared-types';
import { blobFieldsOf, isBlobCollection } from './blob-transform.js';
import { stripForSeal } from './strip.js';

/**
 * The reconnect-reconciliation content fingerprint (Task B9, Finding #7),
 * extracted from `reconcile.ts` into its own module so both the push-ack path
 * (`worker.ts` → `seal-batch.ts`) and the pull-apply path (`apply.ts`) can hash
 * a row without creating an import cycle back through `reconcile.ts` (which
 * itself imports `worker.ts` for `drainOutbox`/`readLocalRow`).
 *
 * See `reconcile.ts`'s module doc-comment for the full "why a hash, why THIS
 * hash" rationale (deterministic pre-seal plaintext, never the nonce-dependent
 * `ciphertextHash`, never sent to the server).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `true` only for a bare `{...}` object literal (or `Object.create(null)`) —
 * i.e. exactly the shape {@link canonicaliseKeyOrder} should recurse into and
 * re-key. Deliberately excludes `Uint8Array`, `Date`, `Blob`, `ArrayBuffer`
 * and any other class instance (different prototype), so they fall through
 * to {@link canonicaliseKeyOrder}'s `return value` branch untouched and reach
 * `encodeRow`'s own `instanceof`-based special-casing exactly as before.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-sorts object keys so identical logical content always serialises to
 * byte-identical output, regardless of each object's key INSERTION ORDER
 * (Task B11 LOW finding: `encodeRow` is a bare `JSON.stringify` and preserves
 * insertion order verbatim, so two devices holding the same content built via
 * different code paths — a field backfill, a Dexie migration — could
 * previously serialise to different bytes and make the equal-timestamp
 * content tiebreak in `resolution.ts`'s `lww` pick OPPOSITE winners on each
 * device, permanently diverging). ARRAY element order is left intact —
 * arrays are content-significant (e.g. `messages.contentBlocks`), never a
 * key/value bag. This is purely a comparison-representation transform: it
 * runs only ahead of {@link canonicalRowBytes}'s `encodeRow` call, never on
 * the real seal path, so the sealed wire format is unaffected.
 */
function canonicaliseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicaliseKeyOrder);
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicaliseKeyOrder(value[key]);
    }
    return sorted;
  }
  return value;
}

/** LOCAL SHA-256 → base64url of the given bytes. */
async function sha256B64(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toBase64Url(new Uint8Array(digest));
}

/**
 * The deterministic, MK-independent, pre-seal canonical wire-form bytes of a
 * row (the same `stripForSeal` transform the real seal path uses, minus the
 * raw blob `Blob` fields — they are neither part of the record's ciphertext,
 * nor JSON-encodable — then {@link canonicaliseKeyOrder}-ed so identical
 * content is byte-identical regardless of key insertion order). This
 * key-sort is a comparison-only transform local to this function — it never
 * touches the real seal path's `encodeRow` call, so the sealed wire format
 * and its ciphertext are unaffected; only this device-local comparison
 * representation is canonical. Synchronous and side-effect-free, so callers
 * that cannot await inside a Dexie transaction (`resolution.ts`'s same-timestamp
 * tiebreak, `apply.ts`'s conflict fold) can call it directly; {@link hashRow}
 * layers the async SHA-256 digest on top for callers that want a compact
 * fingerprint instead of the raw bytes.
 */
export function canonicalRowBytes(collection: SyncCollection, row: unknown): Uint8Array {
  let wireRow = stripForSeal(collection, row);
  if (isBlobCollection(collection) && isRecord(wireRow)) {
    const clone: Record<string, unknown> = { ...wireRow };
    for (const field of blobFieldsOf(collection)) delete clone[field.bytesField];
    wireRow = clone;
  }
  return encodeRow(canonicaliseKeyOrder(wireRow));
}

/**
 * The deterministic, MK-independent content fingerprint of a row's pre-seal
 * wire form ({@link canonicalRowBytes} through SHA-256). Shared by:
 *  - `reconcile.ts`, which compares this against the stored `localContentHash`
 *    baseline for every already-synced row on its coarse pass;
 *  - `worker.ts`'s `applyOk` (via `seal-batch.ts`'s `prepareRecord`), which
 *    stamps the baseline to the content just pushed on a successful ack;
 *  - `apply.ts`'s pull-apply path, which stamps the baseline to the content
 *    just written locally from a pulled row.
 * Keeping the baseline fresh at both convergence points closes the gap a bare
 * `syncRows.put()` whole-record replace would otherwise reopen on every normal
 * push/pull (it carries no `localContentHash`, so it would silently wipe the
 * baseline back to "unknown" and the next reconcile would re-bootstrap instead
 * of comparing).
 */
export async function hashRow(collection: SyncCollection, row: unknown): Promise<string> {
  return sha256B64(canonicalRowBytes(collection, row));
}
