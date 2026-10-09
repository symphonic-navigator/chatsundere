// SPDX-License-Identifier: AGPL-3.0-only
import { useStorageStatus } from '../../../projects/persistence.js';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Rough human size: whole numbers from 10 upwards, one decimal below ("12 MB", "1.5 GB"). */
export function formatStorage(bytes: number): string {
  let n = Math.max(0, bytes);
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const shown = n >= 10 || unit === 0 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${shown} ${UNITS[unit]}`;
}

/** Storage state at the top of `/app/projects` (spec §6.2): persistence, usage, locality. */
export function StorageCard(): JSX.Element {
  const { loaded, persisted, usage, quota } = useStorageStatus();
  return (
    <section
      aria-label="Storage"
      className="flex flex-col gap-1 rounded-md border border-white/5 bg-white/[0.02] p-3 text-[11px] text-paper-soft"
    >
      {!loaded ? null : persisted === true ? (
        <p>Storage is persistent</p>
      ) : (
        <p>
          <span>
            The browser may clear this data when space runs low — export projects you care about.
          </span>
          <span className="ml-1 text-paper-soft/70">
            (Export is in each project&apos;s ⋯ menu.)
          </span>
        </p>
      )}
      {usage !== null && quota !== null ? (
        <p>{`Chatsundere uses ${formatStorage(usage)} of about ${formatStorage(quota)} available`}</p>
      ) : null}
      <p>Projects live on this device only for now.</p>
    </section>
  );
}
