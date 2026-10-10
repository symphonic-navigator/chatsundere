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

function clickDeletePermanently(): void {
  const toast = useToastStore.getState().toasts[0];
  if (!toast?.secondaryAction) throw new Error('no delete-permanently action');
  toast.secondaryAction.onClick();
}

function clickUndo(): void {
  const toast = useToastStore.getState().toasts[0];
  if (!toast?.action) throw new Error('no undo toast');
  toast.action.onClick();
}

describe('showCardDeleteToast', () => {
  beforeEach(() => {
    toastStore.clear();
    restoreCard.mockClear();
    purgeCard.mockClear();
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

  it('turns any other Undo failure into a warning toast', async () => {
    const failure = new Error('disk on fire');
    const restore = vi.fn(async () => {
      throw failure;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invalidate = vi.fn();
    showCardDeleteToast('batch:k1', { kind: 'in-place', restore }, invalidate);

    clickUndo();

    await vi.waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => [t.message, t.tone])).toContainEqual([
        'Could not restore. Please try again.',
        'warn',
      ]);
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.any(String), failure);
    warn.mockRestore();
  });

  it('purges on "Delete permanently" and confirms', async () => {
    const invalidate = vi.fn();
    showCardDeleteToast('batch:k1', { kind: 'in-place', restore: vi.fn() }, invalidate);

    clickDeletePermanently();

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(purgeCard).toHaveBeenCalledWith('batch:k1');
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Deleted.');
  });

  it('turns a failed "Delete permanently" into a warning toast', async () => {
    const failure = new Error('disk on fire');
    purgeCard.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invalidate = vi.fn();
    showCardDeleteToast('batch:k1', { kind: 'in-place', restore: vi.fn() }, invalidate);

    clickDeletePermanently();

    await vi.waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => [t.message, t.tone])).toContainEqual([
        'Could not delete. Please try again.',
        'warn',
      ]);
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.any(String), failure);
    warn.mockRestore();
  });
});
