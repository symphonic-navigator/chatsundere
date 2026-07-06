// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncStateRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import type { DoorbellSocket } from '../../src/sync/doorbell.js';
import {
  _resetDoorbellForTests,
  _setDoorbellRefresh,
  _setDoorbellScheduler,
  _setTicketFetcher,
  _setWebSocketFactory,
  doorbellDiagnostics,
  initDoorbell,
} from '../../src/sync/doorbell.js';

/** A driveable mock socket: capture handlers, emit them from the test. */
class MockSocket {
  url: string;
  closed = false;
  closeCode: number | undefined;
  private handlers = new Map<string, (event: { data?: unknown; code?: number }) => void>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(
    type: string,
    listener: (event: { data?: unknown; code?: number }) => void,
  ): void {
    this.handlers.set(type, listener);
  }
  close(code?: number): void {
    this.closed = true;
    this.closeCode = code;
  }
  emitOpen(): void {
    this.handlers.get('open')?.({});
  }
  emitMessage(data: unknown): void {
    this.handlers.get('message')?.({ data });
  }
  emitClose(code: number): void {
    this.handlers.get('close')?.({ code });
  }
}

const sockets: MockSocket[] = [];
function installMockFactory(): void {
  _setWebSocketFactory((url) => {
    const s = new MockSocket(url);
    sockets.push(s);
    // The mock satisfies DoorbellSocket for the events the consumer uses.
    return s as unknown as DoorbellSocket;
  });
}
function latestSocket(): MockSocket {
  const s = sockets[sockets.length - 1];
  if (!s) throw new Error('no socket created');
  return s;
}

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

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

async function seedSyncState(patch: Partial<SyncStateRow>): Promise<void> {
  const base: SyncStateRow = {
    id: 'state',
    epoch: null,
    watermarkRev: 0,
    lastSyncAt: null,
    pulling: null,
    attention: null,
  };
  await getClientDataDb().syncState.put({ ...base, ...patch });
}

/** Flush the microtask chain (ticket fetch → gate re-check → factory). */
async function tick(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Let a fire-and-forget handler's Dexie read settle (real-timer tests only). */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  sockets.length = 0;
  installMockFactory();
  _setTicketFetcher(async () => 'TICKET-XYZ');
  _setDoorbellScheduler(() => undefined);
  setVisibility('visible');
  seedLinkedOnline();
});

afterEach(() => {
  _resetDoorbellForTests();
  vi.useRealTimers();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
});

describe('ticket → connect', () => {
  it('fetches a ticket and connects a wss socket carrying it', async () => {
    initDoorbell();
    await tick();
    expect(sockets).toHaveLength(1);
    expect(latestSocket().url).toMatch(/^wss:\/\/sync\.example\/api\/v1\/sync\/doorbell\?ticket=/);
    expect(latestSocket().url).toContain('TICKET-XYZ');
    expect(doorbellDiagnostics().connected).toBe(true);
  });
});

describe('poke → schedule', () => {
  it('schedules a cycle when rev is ahead of the watermark', async () => {
    await seedSyncState({ epoch: 'E1', watermarkRev: 2 });
    const scheduler = vi.fn();
    _setDoorbellScheduler(scheduler);
    initDoorbell();
    await tick();
    latestSocket().emitMessage(JSON.stringify({ rev: 5, epoch: 'E1' }));
    await settle();
    expect(scheduler).toHaveBeenCalledTimes(1);
  });

  it('does NOT schedule when rev is not ahead and the epoch matches', async () => {
    await seedSyncState({ epoch: 'E1', watermarkRev: 5 });
    const scheduler = vi.fn();
    _setDoorbellScheduler(scheduler);
    initDoorbell();
    await tick();
    latestSocket().emitMessage(JSON.stringify({ rev: 5, epoch: 'E1' }));
    await settle();
    expect(scheduler).not.toHaveBeenCalled();
  });

  it('schedules a verification cycle on an epoch mismatch (never recovery)', async () => {
    await seedSyncState({ epoch: 'E1', watermarkRev: 100 });
    const scheduler = vi.fn();
    _setDoorbellScheduler(scheduler);
    initDoorbell();
    await tick();
    // rev is BEHIND the watermark, but the epoch differs → still schedule.
    latestSocket().emitMessage(JSON.stringify({ rev: 1, epoch: 'E9' }));
    await settle();
    expect(scheduler).toHaveBeenCalledTimes(1);
  });
});

describe('close-code 4401 → one refresh per backoff cycle, then degrade', () => {
  it('refreshes at most once before a successful open, then keeps backing off', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => true);
    _setDoorbellRefresh(refresh);
    initDoorbell();
    await vi.advanceTimersByTimeAsync(0); // flush the ticket → connect
    expect(sockets).toHaveLength(1);

    // First 4401: exactly one refresh, then a reconnect is scheduled.
    latestSocket().emitClose(4401);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The 4401 close is a BACKGROUND signal (§5.2): the refresh MUST carry the
    // 'background' origin so a definitive refusal latches auth-degraded rather
    // than logging the user out. A default ('user') origin here was the CRITICAL
    // that destroyed the session in the exact "server forgot this client" case.
    expect(refresh).toHaveBeenCalledWith(expect.any(String), 'background');

    // The reconnect fires with a FRESH ticket (a new socket), open never arrives.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);

    // Second 4401 in the same backoff cycle: NO further refresh (cap at one).
    latestSocket().emitClose(4401);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // It degrades to slow reconnects, never escalating the refresh count.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle gating', () => {
  it('does not connect while unlocked-but-hidden', async () => {
    setVisibility('hidden');
    initDoorbell();
    await tick();
    expect(sockets).toHaveLength(0);
  });

  it('does not connect when the session is locked (no MK)', async () => {
    useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: null });
    initDoorbell();
    await tick();
    expect(sockets).toHaveLength(0);
  });

  it('disconnects when connectivity goes offline', async () => {
    initDoorbell();
    await tick();
    expect(doorbellDiagnostics().connected).toBe(true);
    const s = latestSocket();
    useConnectivityStore.setState({ state: { kind: 'local_offline' } });
    expect(s.closed).toBe(true);
    expect(doorbellDiagnostics().connected).toBe(false);
  });
});

describe('diagnostics never leak the ticket or the WSS URL (Larissa I-4)', () => {
  it('excludes both from diagnostics and never logs them', async () => {
    _setTicketFetcher(async () => 'SUPER-SECRET-TICKET');
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy2 = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    initDoorbell();
    await tick();
    latestSocket().emitMessage(JSON.stringify({ rev: 9, epoch: 'E1' }));
    latestSocket().emitClose(4401);
    await tick();

    const diag = JSON.stringify(doorbellDiagnostics());
    expect(diag).not.toContain('SUPER-SECRET-TICKET');
    expect(diag).not.toContain('wss://');
    expect(diag).not.toContain('doorbell');

    const allLogArgs = [
      ...logSpy.mock.calls,
      ...errSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...logSpy2.mock.calls,
    ]
      .flat()
      .map((a) => String(a))
      .join(' ');
    expect(allLogArgs).not.toContain('SUPER-SECRET-TICKET');
    expect(allLogArgs).not.toContain('wss://');

    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy2.mockRestore();
  });
});
