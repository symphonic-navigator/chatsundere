// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAppUpdateForTests, useAppUpdateStore } from '../../src/sw/app-update.store.js';
import {
  UPDATE_CHECK_INTERVAL_MS,
  type WireOptions,
  checkRegistration,
  peekRegistration,
  wireAppUpdates,
} from '../../src/sw/update-wiring.js';

type FakeWorker = EventTarget & { state: string; postMessage: ReturnType<typeof vi.fn> };
type FakeReg = EventTarget & {
  waiting: FakeWorker | null;
  installing: FakeWorker | null;
  update: ReturnType<typeof vi.fn>;
};
type FakeContainer = EventTarget & {
  controller: object | null;
  register: ReturnType<typeof vi.fn>;
};

function fakeWorker(state = 'installing'): FakeWorker {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
}

function fakeReg(opts: Partial<Pick<FakeReg, 'waiting' | 'installing' | 'update'>> = {}): FakeReg {
  return Object.assign(new EventTarget(), {
    waiting: opts.waiting ?? null,
    installing: opts.installing ?? null,
    update: opts.update ?? vi.fn().mockResolvedValue(undefined),
  });
}

function fakeContainer(controller: object | null, reg: FakeReg = fakeReg()): FakeContainer {
  return Object.assign(new EventTarget(), {
    controller,
    register: vi.fn().mockResolvedValue(reg),
  });
}

/** Wires against injected fakes and lets the registration promise settle. */
async function wire(container: FakeContainer, extra: Partial<WireOptions> = {}) {
  const quiesce = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn();
  await wireAppUpdates({
    container: container as unknown as ServiceWorkerContainer,
    swUrl: '/sw.js',
    scope: '/',
    type: 'classic',
    quiesce,
    reload,
    ...extra,
  });
  return { quiesce, reload };
}

function asReg(r: FakeReg): ServiceWorkerRegistration {
  return r as unknown as ServiceWorkerRegistration;
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function becomeVisible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

// wireAppUpdates lives for the page; track its document listeners so one test's
// stale container cannot answer the next test's visibilitychange.
const docListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const realAdd = document.addEventListener.bind(document);

beforeEach(() => {
  _resetAppUpdateForTests();
  setOnline(true);
  vi.useFakeTimers();
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) docListeners.push([type, listener]);
    realAdd(type, listener, options);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [type, listener] of docListeners.splice(0))
    document.removeEventListener(type, listener);
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'onLine');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('checkRegistration / peekRegistration', () => {
  it('returns ready when a worker is waiting and flips updateReady', async () => {
    expect(await checkRegistration(asReg(fakeReg({ waiting: fakeWorker('installed') })))).toBe(
      'ready',
    );
    expect(useAppUpdateStore.getState().updateReady).toBe(true);
  });

  it('returns installing when only installing is set', async () => {
    expect(await checkRegistration(asReg(fakeReg({ installing: fakeWorker() })))).toBe(
      'installing',
    );
    expect(useAppUpdateStore.getState().updateReady).toBe(false);
  });

  it('returns none when neither is set', async () => {
    expect(await checkRegistration(asReg(fakeReg()))).toBe('none');
  });

  it('skips update() while offline', async () => {
    setOnline(false);
    const reg = fakeReg();
    await checkRegistration(asReg(reg));
    expect(reg.update).not.toHaveBeenCalled();
  });

  it('swallows a rejected update()', async () => {
    const reg = fakeReg({ update: vi.fn().mockRejectedValue(new Error('network unreachable')) });
    expect(await checkRegistration(asReg(reg))).toBe('none');
  });

  it('peek never calls update()', () => {
    const reg = fakeReg({ installing: fakeWorker() });
    expect(peekRegistration(asReg(reg))).toBe('installing');
    expect(reg.update).not.toHaveBeenCalled();
  });
});

describe('wireAppUpdates', () => {
  it('registers the given worker URL with scope and type', async () => {
    const c = fakeContainer({});
    await wire(c, { swUrl: '/base/sw.js', scope: '/base/' });
    expect(c.register).toHaveBeenCalledWith('/base/sw.js', { scope: '/base/', type: 'classic' });
  });

  it('marks update-ready when a worker is already waiting behind a controller', async () => {
    await wire(fakeContainer({}, fakeReg({ waiting: fakeWorker('installed') })));
    expect(useAppUpdateStore.getState().updateReady).toBe(true);
  });

  it('marks update-ready when a newly found worker reaches installed behind a controller', async () => {
    const reg = fakeReg();
    await wire(fakeContainer({}, reg));
    const incoming = fakeWorker();
    reg.installing = incoming;
    reg.dispatchEvent(new Event('updatefound'));
    expect(useAppUpdateStore.getState().updateReady).toBe(false);
    incoming.state = 'installed';
    incoming.dispatchEvent(new Event('statechange'));
    expect(useAppUpdateStore.getState().updateReady).toBe(true);
  });

  it('does not mark update-ready on a first install (no controller)', async () => {
    const reg = fakeReg();
    await wire(fakeContainer(null, reg));
    const incoming = fakeWorker();
    reg.installing = incoming;
    reg.dispatchEvent(new Event('updatefound'));
    incoming.state = 'installed';
    incoming.dispatchEvent(new Event('statechange'));
    expect(useAppUpdateStore.getState().updateReady).toBe(false);
  });

  it('applyUpdate posts SKIP_WAITING to the waiting worker', async () => {
    const waiting = fakeWorker('installed');
    await wire(fakeContainer({}, fakeReg({ waiting })));
    useAppUpdateStore.getState().applyUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(useAppUpdateStore.getState().applying).toBe(true);
  });

  it('applyUpdate with no waiting worker resets the applying latch', async () => {
    await wire(fakeContainer({}, fakeReg()));
    useAppUpdateStore.getState().applyUpdate();
    expect(useAppUpdateStore.getState().applying).toBe(false);
  });

  it('peekForUpdate reports a failed install as none without calling update()', async () => {
    const reg = fakeReg({ installing: fakeWorker() });
    await wire(fakeContainer({}, reg));
    await vi.advanceTimersByTimeAsync(0);
    const updatesSoFar = reg.update.mock.calls.length;
    expect(useAppUpdateStore.getState().peekForUpdate()).toBe('installing');
    // The install fails: the browser drops the installing worker and nothing waits.
    reg.installing = null;
    reg.waiting = null;
    expect(useAppUpdateStore.getState().peekForUpdate()).toBe('none');
    expect(reg.update).toHaveBeenCalledTimes(updatesSoFar);
  });

  it('checks on registration, on visibility → visible, and hourly', async () => {
    const reg = fakeReg();
    await wire(fakeContainer({}, reg));
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.update).toHaveBeenCalledTimes(1);

    becomeVisible();
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.update).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(reg.update).toHaveBeenCalledTimes(3);
  });

  it('reloads on controllerchange this tab initiated', async () => {
    const c = fakeContainer({}, fakeReg({ waiting: fakeWorker('installed') }));
    const { reload, quiesce } = await wire(c);
    useAppUpdateStore.getState().applyUpdate();
    c.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useAppUpdateStore.getState().updatedElsewhere).toBe(false);
    expect(quiesce).not.toHaveBeenCalled();
  });

  it('strands and quiesces on a controllerchange another tab caused', async () => {
    const c = fakeContainer({});
    const { reload, quiesce } = await wire(c);
    c.dispatchEvent(new Event('controllerchange'));
    expect(useAppUpdateStore.getState().updatedElsewhere).toBe(true);
    expect(quiesce).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores controllerchange when the page had no controller at load (first install)', async () => {
    const c = fakeContainer(null);
    const { reload, quiesce } = await wire(c);
    c.controller = {};
    c.dispatchEvent(new Event('controllerchange'));
    expect(useAppUpdateStore.getState().updatedElsewhere).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(quiesce).not.toHaveBeenCalled();
  });

  it('strands a tab that wakes up to find its controller replaced', async () => {
    const c = fakeContainer({});
    const { quiesce } = await wire(c);
    // The tab was frozen: no controllerchange arrived, but the controller moved on.
    c.controller = {};
    becomeVisible();
    expect(useAppUpdateStore.getState().updatedElsewhere).toBe(true);
    expect(quiesce).toHaveBeenCalledTimes(1);
  });

  it('does not strand on visibility when the controller is unchanged', async () => {
    const c = fakeContainer({});
    const { quiesce } = await wire(c);
    becomeVisible();
    expect(useAppUpdateStore.getState().updatedElsewhere).toBe(false);
    expect(quiesce).not.toHaveBeenCalled();
  });

  it('quiesces only once when both signals arrive', async () => {
    const c = fakeContainer({});
    const { quiesce } = await wire(c);
    c.controller = {};
    c.dispatchEvent(new Event('controllerchange'));
    becomeVisible();
    expect(quiesce).toHaveBeenCalledTimes(1);
  });

  it('is a no-op beyond presence where service workers are unsupported', async () => {
    await wireAppUpdates({
      container: undefined,
      swUrl: '/sw.js',
      scope: '/',
      type: 'classic',
      quiesce: vi.fn(),
    });
    expect(useAppUpdateStore.getState().peekForUpdate()).toBe('none');
  });
});
