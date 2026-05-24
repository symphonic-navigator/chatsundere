// SPDX-License-Identifier: AGPL-3.0-only

export function BottomAffordance({ onTap }: { onTap: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="affordance"
      aria-label="Enter interaction mode"
      onClick={onTap}
    >
      <div className="affordance-bar" />
    </button>
  );
}
