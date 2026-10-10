// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

/** Storage persistence and usage; `null` where the browser lacks the API. */
export interface StorageStatus {
  /** False until the first read has completed; the other fields are not yet meaningful. */
  loaded: boolean;
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

const listeners = new Set<() => void>();

function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/**
 * Asks the browser to keep this origin's data (spec §6.5) while it is not yet
 * persistent. Chromium decides silently; Firefox prompts once. Never throws.
 */
export async function requestPersistence(): Promise<void> {
  const storage = storageManager();
  if (!storage?.persisted || !storage.persist) return;
  try {
    if (await storage.persisted()) return;
    await storage.persist();
  } catch (e) {
    console.warn('Storage persistence request failed', e);
  }
  for (const notify of listeners) notify();
}

async function readStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  const status: StorageStatus = { loaded: true, persisted: null, usage: null, quota: null };
  if (!storage) return status;
  try {
    if (storage.persisted) status.persisted = await storage.persisted();
  } catch {
    status.persisted = null;
  }
  try {
    if (storage.estimate) {
      const est = await storage.estimate();
      status.usage = est.usage ?? null;
      status.quota = est.quota ?? null;
    }
  } catch {
    // Leave usage unknown; the card simply omits the line.
  }
  return status;
}

/** Live storage status; refreshes after each {@link requestPersistence}. */
export function useStorageStatus(): StorageStatus {
  const [status, setStatus] = useState<StorageStatus>({
    loaded: false,
    persisted: null,
    usage: null,
    quota: null,
  });
  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      void readStatus().then((s) => {
        if (alive) setStatus(s);
      });
    };
    refresh();
    listeners.add(refresh);
    return () => {
      alive = false;
      listeners.delete(refresh);
    };
  }, []);
  return status;
}
