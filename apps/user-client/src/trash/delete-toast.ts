// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { toastStore } from '../state/toast.store.js';
import { type TrashUndoHandle, UndoDrainedError } from './delete-flow.js';
import { purgeCard, restoreCard } from './trash-repo.js';

/** After a soft-delete, surface the delete-time signal: a toast with Undo (fast,
 *  identity-preserving before drain; falls back to the new-identity restore once the
 *  delete has drained) and a "Delete permanently" that removes the recoverable copy. */
export function showDeleteToast(
  collection: SyncCollection,
  key: string,
  handle: TrashUndoHandle,
  invalidate: () => void,
): void {
  const cardKey = `${collection}:${key}`;
  toastStore.show({
    message: 'Moved to Recently deleted · recoverable for 30 days',
    tone: 'info',
    durationMs: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        void (async () => {
          try {
            await handle.restore();
          } catch (e) {
            if (e instanceof UndoDrainedError) await restoreCard(cardKey);
            else throw e;
          }
          invalidate();
          toastStore.show({ message: 'Restored.', tone: 'success', durationMs: 2500 });
        })();
      },
    },
    secondaryAction: {
      label: 'Delete permanently',
      onClick: () => {
        void (async () => {
          await purgeCard(cardKey);
          invalidate();
          toastStore.show({ message: 'Deleted.', tone: 'success', durationMs: 2500 });
        })();
      },
    },
  });
}
