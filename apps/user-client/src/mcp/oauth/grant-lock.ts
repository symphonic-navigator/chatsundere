// SPDX-License-Identifier: AGPL-3.0-only

/** Runs `fn` while holding the lock for `serverId`; a `signal` only cancels the wait. */
export type GrantLockFn = <T>(
  serverId: string,
  fn: () => Promise<T>,
  opts?: { signal?: AbortSignal | undefined },
) => Promise<T>;

/** The Web Lock serialising one grant's refresh across this device's tabs (spec §5). */
export function grantLockName(serverId: string): string {
  return `chatsundere-mcp-oauth-${serverId}`;
}

function abortError(): DOMException {
  return new DOMException('The wait for the lock was cancelled.', 'AbortError');
}

/** Resolves with `p`, or rejects with an AbortError once `signal` aborts. */
function waitUnlessAborted(p: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * A queueing in-process mutex per name, for where Web Locks are absent. Unlike the
 * sync lock's fallback it really waits: two callers never run `fn` at the same time.
 */
export function createNamedMutex(): GrantLockFn {
  const tails = new Map<string, Promise<void>>();
  return async <T>(
    name: string,
    fn: () => Promise<T>,
    opts?: { signal?: AbortSignal | undefined },
  ): Promise<T> => {
    const previous = tails.get(name) ?? Promise.resolve();
    let release = (): void => undefined;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A caller that gives up still keeps its place until the holder before it is done.
    const tail = previous.then(() => mine);
    tails.set(name, tail);
    try {
      await waitUnlessAborted(previous, opts?.signal);
      return await fn();
    } finally {
      release();
      if (tails.get(name) === tail) tails.delete(name);
    }
  };
}

const fallback = createNamedMutex();

/**
 * Holds the grant's Web Lock while `fn` runs. Not re-entrant. Nothing run under it may
 * take the sync lock or wait on a sync cycle: the grant lock is the outer one.
 */
export const withGrantLock: GrantLockFn = (serverId, fn, opts) => {
  const name = grantLockName(serverId);
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    const options: LockOptions = opts?.signal ? { signal: opts.signal } : {};
    return locks.request(name, options, () => fn()) as Promise<Awaited<ReturnType<typeof fn>>>;
  }
  return fallback(name, fn, opts);
};
