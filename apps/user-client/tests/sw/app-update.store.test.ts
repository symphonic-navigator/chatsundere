// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  APPLY_TIMEOUT_MS,
  _resetAppUpdateForTests,
  isApplyingHere,
  useAppUpdateStore,
} from '../../src/sw/app-update.store.js';

beforeEach(() => _resetAppUpdateForTests());
afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
});

it('is a safe no-op before the service worker is bound (dev/test)', async () => {
  const s = useAppUpdateStore.getState();
  expect(s.updateReady).toBe(false);
  s.applyUpdate();
  expect(isApplyingHere()).toBe(false);
  expect(await s.checkForUpdate()).toBe('none');
  expect(s.peekForUpdate()).toBe('none');
});

it('applies at most once per page load and exposes applying in state', () => {
  const apply = vi.fn(() => true);
  useAppUpdateStore.getState().bind({ apply, check: async () => 'none', peek: () => 'none' });
  useAppUpdateStore.getState().applyUpdate();
  useAppUpdateStore.getState().applyUpdate();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(isApplyingHere()).toBe(true);
  expect(useAppUpdateStore.getState().applying).toBe(true);
});

it('releases the applying latch when no worker is waiting', () => {
  const apply = vi.fn(() => false);
  useAppUpdateStore.getState().bind({ apply, check: async () => 'none', peek: () => 'none' });
  useAppUpdateStore.getState().applyUpdate();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(useAppUpdateStore.getState().applying).toBe(false);
});

it('releases the applying latch if no controllerchange reloads the page in time', () => {
  vi.useFakeTimers();
  useAppUpdateStore
    .getState()
    .bind({ apply: () => true, check: async () => 'none', peek: () => 'none' });
  useAppUpdateStore.getState().applyUpdate();
  vi.advanceTimersByTime(APPLY_TIMEOUT_MS - 1);
  expect(useAppUpdateStore.getState().applying).toBe(true);
  vi.advanceTimersByTime(1);
  expect(useAppUpdateStore.getState().applying).toBe(false);
});

it('delegates checks and peeks to the bindings', async () => {
  useAppUpdateStore
    .getState()
    .bind({ apply: vi.fn(() => true), check: async () => 'installing', peek: () => 'ready' });
  expect(await useAppUpdateStore.getState().checkForUpdate()).toBe('installing');
  expect(useAppUpdateStore.getState().peekForUpdate()).toBe('ready');
});

it('marks update-ready and updated-elsewhere', () => {
  useAppUpdateStore.getState().markUpdateReady();
  useAppUpdateStore.getState().markUpdatedElsewhere();
  expect(useAppUpdateStore.getState().updateReady).toBe(true);
  expect(useAppUpdateStore.getState().updatedElsewhere).toBe(true);
});
