// SPDX-License-Identifier: AGPL-3.0-only

/** A horizontal rule with a centred date label between two hairlines.
 *  Uses role="separator" on a div (rather than <hr>) because the element
 *  contains visible children; tabIndex={-1} satisfies keyboard reachability. */
export function DateSeparator({ label }: { label: string }): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: composite separator wraps child spans — <hr> cannot contain children
    <div className="date-sep" role="separator" aria-label={label} tabIndex={-1}>
      <span className="date-sep-line" />
      <span>{label}</span>
      <span className="date-sep-line" />
    </div>
  );
}
