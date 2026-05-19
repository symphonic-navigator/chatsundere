// SPDX-License-Identifier: AGPL-3.0-only
import { getStaging, reconcileStagingOnBoot } from '@chatsundere/crypto';
import type { StagingOutcome } from '../state/boot.store.js';
import { getDb } from './open-db.js';

export async function reconcileStaging(): Promise<StagingOutcome> {
  const db = getDb();
  const before = await getStaging(db);
  if (!before) return { kind: 'none' };
  await reconcileStagingOnBoot(db);
  const after = await getStaging(db);
  if (after !== null) {
    return { kind: 'rolled_back' };
  }
  return before.server_state === 'committed' ? { kind: 'completed' } : { kind: 'rolled_back' };
}
