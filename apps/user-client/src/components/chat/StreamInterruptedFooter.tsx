// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  onRetry: () => void;
  onDiscard: () => void;
  disabled?: boolean;
}

/** Rendered below an incomplete persona-message to offer Retry / Discard recovery. */
export function StreamInterruptedFooter(p: Props): JSX.Element {
  return (
    <div className="stream-interrupted" role="alert">
      <div className="stream-interrupted-text">
        <span aria-hidden="true">⚠</span>
        <span>Stream interrupted</span>
      </div>
      <div className="stream-interrupted-actions">
        <button
          type="button"
          data-action="retry"
          disabled={p.disabled}
          onClick={p.onRetry}
          className="ctrl-btn"
        >
          ↻ Retry
        </button>
        <button
          type="button"
          data-action="discard"
          disabled={p.disabled}
          onClick={p.onDiscard}
          className="ctrl-btn"
        >
          ⌫ Discard
        </button>
      </div>
    </div>
  );
}
