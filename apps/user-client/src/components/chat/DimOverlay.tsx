// SPDX-License-Identifier: AGPL-3.0-only

/** Semi-opaque backdrop that activates while the chat textarea has focus. */
export function DimOverlay({ active }: { active: boolean }): JSX.Element {
  return (
    <div className="dim-overlay" data-active={active ? 'true' : undefined} aria-hidden="true" />
  );
}
