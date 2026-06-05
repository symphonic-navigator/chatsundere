// SPDX-License-Identifier: AGPL-3.0-only

export function ScrollToEnd({
  visible,
  onTap,
}: { visible: boolean; onTap: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="scroll-to-end"
      data-visible={visible ? 'true' : 'false'}
      aria-label="Scroll to end"
      onClick={onTap}
    >
      <span aria-hidden="true">↓</span>
      <span>To end</span>
    </button>
  );
}
