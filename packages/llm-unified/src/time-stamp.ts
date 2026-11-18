// SPDX-License-Identifier: LGPL-3.0-only

// Every byte these functions produce lands in a provider's prompt-cache prefix,
// so the render is pinned: constant English name tables, UTC getters on an
// instant already shifted by the stored offset, and no `Intl` or `toLocale*`.
// Neither the runtime's time zone, its locale nor its ICU version can change
// the output.

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface LocalParts {
  weekday: number;
  day: number;
  month: number;
  year: number;
  hhmm: string;
}

function localParts(instant: number, utcOffsetMinutes: number): LocalParts {
  const local = new Date(instant + utcOffsetMinutes * MINUTE_MS);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return {
    weekday: local.getUTCDay(),
    day: local.getUTCDate(),
    month: local.getUTCMonth(),
    year: local.getUTCFullYear(),
    hhmm: `${hh}:${mm}`,
  };
}

/** Render the wire stamp for a user turn, e.g. `<sent>Wed 18 Nov 2026, 21:14</sent>`. */
export function formatSentStamp(createdAt: number, utcOffsetMinutes: number): string {
  const p = localParts(createdAt, utcOffsetMinutes);
  return `<sent>${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month]} ${p.year}, ${p.hhmm}</sent>`;
}

/** Render "now" for the opener prompt, e.g. `Saturday, 21 November 2026, 09:02`. */
export function formatGreetingNow(now: number, utcOffsetMinutes: number): string {
  const p = localParts(now, utcOffsetMinutes);
  return `${WEEKDAYS_LONG[p.weekday]}, ${p.day} ${MONTHS_LONG[p.month]} ${p.year}, ${p.hhmm}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Describe how long the user was away, e.g. `2 days`. Null under one hour,
 * where "welcome back" would be noise. Whole hours under a day, days under
 * two weeks, weeks under sixty days, then 30-day months.
 */
export function formatAwayGap(ms: number): string | null {
  if (ms < HOUR_MS) return null;
  if (ms < DAY_MS) return plural(Math.floor(ms / HOUR_MS), 'hour');
  const days = Math.floor(ms / DAY_MS);
  if (days < 14) return plural(days, 'day');
  if (days < 60) return plural(Math.floor(days / 7), 'week');
  return plural(Math.floor(days / 30), 'month');
}
