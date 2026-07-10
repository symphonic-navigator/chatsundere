// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canonicalRowBytes, hashRow } from '../../src/sync/content-hash.js';

/**
 * Task B11, LOW finding: `canonicalRowBytes` feeds the equal-timestamp
 * content tiebreak in `resolution.ts`'s `lww` and B9's `hashRow` baseline.
 * `encodeRow` is a bare `JSON.stringify` and preserves each object's key
 * INSERTION ORDER, so two devices holding identical logical content built via
 * different code paths (a field backfill, a Dexie migration) could previously
 * serialise to DIFFERENT bytes — making the tiebreak pick OPPOSITE winners on
 * each device and permanently diverge. `canonicalRowBytes` now deep-sorts
 * object keys before encoding so identical content is always byte-identical,
 * regardless of insertion order.
 */

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('canonicalRowBytes — key-order independence (B11 LOW finding)', () => {
  it('identical flat content with different key insertion order encodes to EQUAL bytes', () => {
    const rowA = { id: 'x', updatedAt: 1000, content: 'same content' };
    const rowB = { content: 'same content', id: 'x', updatedAt: 1000 };

    const bytesA = canonicalRowBytes('personas', rowA);
    const bytesB = canonicalRowBytes('personas', rowB);

    expect(bytesToString(bytesB)).toBe(bytesToString(bytesA));
  });

  it('identical nested-object content with different key insertion order (at every depth) encodes to EQUAL bytes', () => {
    const rowA = {
      id: 'x',
      updatedAt: 1000,
      meta: { alpha: 1, beta: { z: 9, a: 8 }, gamma: 3 },
    };
    const rowB = {
      meta: { gamma: 3, beta: { a: 8, z: 9 }, alpha: 1 },
      updatedAt: 1000,
      id: 'x',
    };

    expect(bytesToString(canonicalRowBytes('personas', rowB))).toBe(
      bytesToString(canonicalRowBytes('personas', rowA)),
    );
  });

  it('array ELEMENT ORDER is content-significant and is NOT reordered', () => {
    const rowA = { id: 'x', updatedAt: 1000, items: [{ b: 2, a: 1 }, { c: 3 }] };
    // Same objects (key order varies, harmless), but the ARRAY order is swapped —
    // this is genuinely different content and must NOT canonicalise equal.
    const rowB = { id: 'x', updatedAt: 1000, items: [{ c: 3 }, { a: 1, b: 2 }] };

    expect(bytesToString(canonicalRowBytes('personas', rowB))).not.toBe(
      bytesToString(canonicalRowBytes('personas', rowA)),
    );

    // But reordering only the keys WITHIN each array element (not the elements
    // themselves) must still canonicalise equal.
    const rowC = { updatedAt: 1000, id: 'x', items: [{ a: 1, b: 2 }, { c: 3 }] };
    expect(bytesToString(canonicalRowBytes('personas', rowC))).toBe(
      bytesToString(canonicalRowBytes('personas', rowA)),
    );
  });

  it("Uint8Array fields still round-trip through encodeRow's $bytes convention (value-encoding untouched)", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const rowA = { id: 'x', updatedAt: 1000, payload: bytes };
    const rowB = { updatedAt: 1000, payload: bytes, id: 'x' };

    const out = bytesToString(canonicalRowBytes('personas', rowA));
    expect(out).toContain('$bytes');
    expect(bytesToString(canonicalRowBytes('personas', rowB))).toBe(out);
  });

  it('hashRow (B9 baseline) is also key-order independent', async () => {
    const rowA = { id: 'p1', updatedAt: 1, name: 'v1' };
    const rowB = { name: 'v1', updatedAt: 1, id: 'p1' };

    expect(await hashRow('personas', rowB)).toBe(await hashRow('personas', rowA));
  });
});
