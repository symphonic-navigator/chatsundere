// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';

/**
 * A single old→new id map shared across one import. Every entity is `fresh`-
 * minted exactly once; every foreign reference is rewritten via `map`. Because
 * all ids are regenerated, no DB-level collision is possible.
 */
export class IdRemap {
  private readonly table = new Map<string, string>();

  /** Mint (once) and return the new id for `oldId`. Idempotent. */
  fresh(oldId: string): string {
    const existing = this.table.get(oldId);
    if (existing) return existing;
    const next = uuidv7();
    this.table.set(oldId, next);
    return next;
  }

  /** The new id for an already-minted `oldId`, or undefined. */
  map(oldId: string | null | undefined): string | undefined {
    if (!oldId) return undefined;
    return this.table.get(oldId);
  }

  has(oldId: string): boolean {
    return this.table.has(oldId);
  }
}
