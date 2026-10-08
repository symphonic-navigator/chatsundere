// SPDX-License-Identifier: AGPL-3.0-only
import type { PillRow } from '../../boot/client-data-db.js';
import {
  REPLAY_RESULT_MAX_CHARS,
  SUMMARY_INPUT_MAX_CHARS,
  isCondensable,
  replaySummaryOf,
} from '../../lib/tool-replay.js';
import { useToolSummaryStore } from '../../state/tool-summary.store.js';

/** Whether the pill shows a summary (and so labels its full result). */
export function hasVisibleSummary(row: PillRow): boolean {
  return isCondensable(row) && replaySummaryOf(row) !== null;
}

/**
 * What later turns will see of a long tool result (summaries spec §6): the
 * summary, a pending line, or the head-cut note. Nothing for short results.
 */
export function CondensationSlot({ row }: { row: PillRow }): JSX.Element | null {
  const pending = useToolSummaryStore((s) => s.pending.has(row.id));
  if (!isCondensable(row)) return null;
  const summary = replaySummaryOf(row);
  if (summary !== null) {
    const result = (row.payload as { result: string }).result;
    const heading =
      result.length > SUMMARY_INPUT_MAX_CHARS
        ? `Later turns see this summary of the first ${SUMMARY_INPUT_MAX_CHARS.toLocaleString('en-GB')} characters`
        : 'Later turns see this summary';
    return (
      <span className="pill-detail-condensed">
        <span className="pill-detail-label">{heading}</span>
        <code className="pill-detail-summary">{summary.slice(0, REPLAY_RESULT_MAX_CHARS)}</code>
      </span>
    );
  }
  return (
    <span className="pill-detail-condensed-note">
      {pending
        ? 'Condensing for later turns…'
        : 'Later turns only see the beginning of this result.'}
    </span>
  );
}
