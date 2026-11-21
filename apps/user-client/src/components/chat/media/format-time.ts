// SPDX-License-Identifier: AGPL-3.0-only

const pad = (n: number): string => String(n).padStart(2, '0');

/** A media time in milliseconds as `m:ss`, or `h:mm:ss` from an hour on; invalid times read `0:00`. */
export function formatTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
