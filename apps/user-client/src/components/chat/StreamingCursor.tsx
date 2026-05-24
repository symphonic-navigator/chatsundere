// SPDX-License-Identifier: AGPL-3.0-only

/** Blinking block cursor appended to the active draft message during streaming. */
export function StreamingCursor(): JSX.Element {
  return (
    <span className="streaming-cursor" aria-hidden="true">
      ▍
    </span>
  );
}
