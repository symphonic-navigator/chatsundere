// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from 'vitest';

const calls: string[] = [];
const abortAll = vi.fn(async () => {
  calls.push('abortAll');
});
const close = vi.fn(() => {
  calls.push('close');
});
const getClientDataDb = vi.fn(() => ({ close }));

vi.mock('../../src/state/stream-manager.store.js', () => ({
  useStreamManagerStore: { getState: () => ({ abortAll }) },
}));
vi.mock('../../src/boot/client-data-db.js', () => ({
  getClientDataDb: () => getClientDataDb(),
}));

const { quiesceStrandedTab } = await import('../../src/sw/quiesce.js');

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

it('aborts streams before closing the data DB', async () => {
  await quiesceStrandedTab();
  expect(calls).toEqual(['abortAll', 'close']);
});

it('still closes the DB when aborting fails, and logs the failure', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  abortAll.mockRejectedValueOnce(new Error('boom'));
  await quiesceStrandedTab();
  expect(close).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith(
    '[app-update] aborting streams while quiescing failed',
    expect.any(Error),
  );
  error.mockRestore();
});

it('logs rather than throws when no data DB is open yet', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  getClientDataDb.mockImplementationOnce(() => {
    throw new Error('client-data DB not opened');
  });
  await expect(quiesceStrandedTab()).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
