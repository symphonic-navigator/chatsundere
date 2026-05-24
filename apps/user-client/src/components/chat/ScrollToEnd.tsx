// SPDX-License-Identifier: AGPL-3.0-only

export function ScrollToEnd({ onTap }: { onTap: () => void }): JSX.Element {
  return (
    <button type="button" className="scroll-to-end" aria-label="Scroll to end" onClick={onTap}>
      <span aria-hidden="true">↓</span>
      <span>To end</span>
    </button>
  );
}
