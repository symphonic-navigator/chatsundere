// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SyncPullResponse } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { _resetApplyForTests, setInvalidator } from '../../src/sync/apply.js';
import { _resetRecoveryForTests, _setRecoverySleep } from '../../src/sync/recovery.js';
import { getSyncState } from '../../src/sync/watermark.js';
import {
  PULL_PAGE_CAP,
  _resetWorkerForTests,
  _setPullTransport,
  runPullLoop,
} from '../../src/sync/worker.js';

/**
 * Task B12 (Finding G): `runPullLoop` exits `while (more && pages <
 * PULL_PAGE_CAP)` at the 64-page anti-pin cap (Larissa M-7). Lossless — the
 * watermark holds at the last applied page — but SILENT: nothing raised an
 * indicator and nothing re-triggered a follow-up, so a large first pull
 * (>12,800 records) looked "done" and then trickled in over up to 10 minutes.
 * These tests drive `runPullLoop` directly with an empty-records fixture (the
 * paging/cap mechanics under test do not depend on record application) and
 * assert: a cap-with-more exit (a) keeps the `pulling` indicator up and (b)
 * queues an immediate follow-up that keeps pulling until it drains cleanly;
 * a clean, fully-drained finish (b) clears the indicator and (c) schedules no
 * spurious extra page.
 */

function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  _setRecoverySleep(async () => undefined); // no real backoff sleep in tests
  setInvalidator(() => undefined); // isolate from the shared queryClient
});

afterEach(async () => {
  _resetApplyForTests();
  _resetWorkerForTests();
  _resetRecoveryForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('pull loop — the 64-page cap surfaces and auto-resumes (Task B12, Finding G)', () => {
  it('keeps the pulling indicator up and queues an immediate follow-up when capped with more still true', async () => {
    // Pages 1..PULL_PAGE_CAP all answer `more: true` (the cap trips with pages
    // still owed); page PULL_PAGE_CAP+1 (the follow-up's first page) answers
    // `more: false` (a clean, fully-drained finish) so the chain terminates.
    let pullCalls = 0;
    const pull = vi.fn(async (): Promise<SyncPullResponse> => {
      pullCalls += 1;
      return { head: pullCalls, epoch: 'E1', more: pullCalls <= PULL_PAGE_CAP, records: [] };
    });
    _setPullTransport(pull);

    await runPullLoop();

    // The capped invocation fetched exactly PULL_PAGE_CAP pages...
    expect(pullCalls).toBe(PULL_PAGE_CAP);
    // ...and — this is the RED assertion pre-fix — must NOT look "done": the
    // indicator stays up rather than the old unconditional `finally` clear.
    expect((await getSyncState()).pulling).not.toBeNull();

    // The follow-up is deliberately NOT awaited by `runPullLoop` (awaiting it
    // would deadlock the follow-up against its own Web Lock hold), so wait
    // for it to actually run rather than asserting synchronously.
    await vi.waitFor(() => expect(pullCalls).toBe(PULL_PAGE_CAP + 1));

    // Once the resumed pull drains cleanly, the indicator retires and no
    // further page is fetched.
    await vi.waitFor(async () => {
      expect((await getSyncState()).pulling).toBeNull();
    });
    expect(pullCalls).toBe(PULL_PAGE_CAP + 1);
  });

  it('clears the indicator and schedules no follow-up on a clean, fully-drained finish', async () => {
    let pullCalls = 0;
    const pull = vi.fn(async (): Promise<SyncPullResponse> => {
      pullCalls += 1;
      return { head: pullCalls, epoch: 'E1', more: pullCalls < 2, records: [] };
    });
    _setPullTransport(pull);

    await runPullLoop();

    expect(pullCalls).toBe(2);
    expect((await getSyncState()).pulling).toBeNull();

    // Give any stray scheduled follow-up a turn — a spurious one would show
    // up as a third call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pullCalls).toBe(2);
  });

  it('retires the pulling indicator without a 65th pull when connectivity drops before the queued follow-up is granted', async () => {
    // Reproduces the review defect: `canRunCycle()` flips false (device goes
    // offline) between the cap tripping and the queued follow-up's grant.
    // Flip right as the capping (64th) page lands — before `scheduleCappedFollowUp`
    // ever runs its `canRunCycle()` check.
    let pullCalls = 0;
    const pull = vi.fn(async (): Promise<SyncPullResponse> => {
      pullCalls += 1;
      if (pullCalls === PULL_PAGE_CAP) {
        useConnectivityStore.setState({ state: { kind: 'local_offline' } });
      }
      return { head: pullCalls, epoch: 'E1', more: true, records: [] };
    });
    _setPullTransport(pull);

    await runPullLoop();

    expect(pullCalls).toBe(PULL_PAGE_CAP);
    // Pre-fix (RED): `scheduleCappedFollowUp`'s callback bails on
    // `!canRunCycle()` without ever calling `runPullLoop()` again, so the
    // `finally` that would clear `pulling` never runs — it stays stuck
    // forever. Post-fix (GREEN): the bail itself clears it.
    await vi.waitFor(async () => {
      expect((await getSyncState()).pulling).toBeNull();
    });
    // No 65th page was ever requested — `canRunCycle()` correctly vetoed the
    // follow-up instead of firing a pull while offline.
    expect(pullCalls).toBe(PULL_PAGE_CAP);
  });

  it('clears the indicator even when the queued follow-up itself throws', async () => {
    // The follow-up's `runPullLoop()` call can throw (e.g. a transport error
    // on its first page); the outer `.catch` must not strand `pulling`. Note:
    // this one already passed pre-fix too — `runPullLoop`'s OWN `finally`
    // clears `pulling` on any throw during its own run (`cappedWithMore` only
    // flips true on a clean/capped exit, never on a thrown page). It stays as
    // a regression guard for the outer `.catch` backstop (which matters for a
    // throw that happens BEFORE `runPullLoop` is ever called, e.g. a
    // `withSyncLock`/Web-Locks rejection) — the one genuinely-RED case is the
    // `canRunCycle()` bail covered by the test above.
    let pullCalls = 0;
    const pull = vi.fn(async (): Promise<SyncPullResponse> => {
      pullCalls += 1;
      if (pullCalls > PULL_PAGE_CAP) throw new Error('boom — transport failure on the follow-up');
      return { head: pullCalls, epoch: 'E1', more: true, records: [] };
    });
    _setPullTransport(pull);

    await runPullLoop();

    expect(pullCalls).toBe(PULL_PAGE_CAP);
    expect((await getSyncState()).pulling).not.toBeNull();

    // Wait for the follow-up to fire, throw, and settle.
    await vi.waitFor(() => expect(pullCalls).toBe(PULL_PAGE_CAP + 1));
    await vi.waitFor(async () => {
      expect((await getSyncState()).pulling).toBeNull();
    });
  });
});
