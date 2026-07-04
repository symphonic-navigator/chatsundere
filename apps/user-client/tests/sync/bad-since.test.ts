// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { HttpError } from '../../src/lib/fetch.js';
import { advanceWatermark } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setPullTransport,
  _setRecovery,
  runPullLoop,
} from '../../src/sync/worker.js';

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
  await advanceWatermark(500);
});

afterEach(async () => {
  _resetWorkerForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('bad_since handling (spec §3.2, Larissa L-1 defence-in-depth)', () => {
  it('hands off to recovery when the pull rejects the watermark', async () => {
    let recovered = false;
    _setRecovery(async () => {
      recovered = true;
    });
    _setPullTransport(async () => {
      throw new HttpError(400, 'bad_since', '400 Bad Request');
    });

    await runPullLoop();

    expect(recovered).toBe(true);
  });

  it('propagates any other pull error unchanged', async () => {
    _setPullTransport(async () => {
      throw new HttpError(500, undefined, '500');
    });

    await expect(runPullLoop()).rejects.toMatchObject({ status: 500 });
  });
});
