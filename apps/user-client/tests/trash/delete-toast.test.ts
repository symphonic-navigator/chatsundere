// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fsError } from '../../src/projects/errors.js';
import { toastStore, useToastStore } from '../../src/state/toast.store.js';

const restoreCard = vi.fn(async (_key: string) => undefined);
const purgeCard = vi.fn(async (_key: string) => undefined);

vi.mock('../../src/trash/trash-repo.js', () => ({
  restoreCard: (key: string) => restoreCard(key),
  purgeCard: (key: string) => purgeCard(key),
}));

import { showCardDeleteToast } from '../../src/trash/delete-toast.js';

function clickUndo(): void {
  const toast = useToastStore.getState().toasts[0];
  if (!toast?.action) throw new Error('no undo toast');
  toast.action.onClick();
}

describe('showCardDeleteToast', () => {
  beforeEach(() => {
    toastStore.clear();
    restoreCard.mockClear();
  });

  it('shows the given message and restores in place on Undo', async () => {
    const restore = vi.fn(async () => undefined);
    const invalidate = vi.fn();
    showCardDeleteToast('batch:k1', { kind: 'in-place', restore }, invalidate, 'Moved notes/');
    expect(useToastStore.getState().toasts[0]?.message).toBe('Moved notes/');

    clickUndo();

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(restore).toHaveBeenCalledOnce();
    expect(restoreCard).not.toHaveBeenCalled();
  });

  it('turns an AlreadyExists undo into a warning toast', async () => {
    const restore = vi.fn(async () => {
      throw fsError('AlreadyExists', { path: '/notes/a.md' });
    });
    showCardDeleteToast('batch:k1', { kind: 'in-place', restore }, vi.fn());

    clickUndo();

    await vi.waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => [t.message, t.tone])).toContainEqual([
        "Can't restore: /notes/a.md already exists. Rename or move that file, then restore again.",
        'warn',
      ]);
    });
  });
});
