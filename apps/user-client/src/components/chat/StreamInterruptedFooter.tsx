// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';

interface Props {
  onRetry: () => void;
  onDiscard: () => void;
  disabled?: boolean;
  /**
   * Disables Retry alone (spec §11.2): a retry re-rolls the turn, which
   * tombstones the synced prior user message — a Class-2 write that needs a
   * reachable server. Discard is local cleanup and stays enabled offline.
   */
  retryDisabled?: boolean;
  /** Touch-reachable reason shown under Retry when `retryDisabled` (§11.2). */
  retryDisabledReason?: string;
  /** Present only when an in-memory diagnostic report exists for this message. */
  onShowDiagnostics?: () => void;
  /**
   * Set when the interrupted stream failed because a provider needed the
   * account proxy relay and the device had no link (spec §6, Task E2).
   * Swaps the generic "Stream interrupted" heading for the specific remedy
   * and adds an "Open Server linking" affordance alongside Retry/Discard —
   * the destination screen carries the identical name (naming parity).
   */
  failureKind?: 'proxy_unavailable';
}

/** Rendered below an incomplete persona-message to offer Retry / Discard recovery. */
export function StreamInterruptedFooter(p: Props): JSX.Element {
  const proxyUnavailable = p.failureKind === 'proxy_unavailable';
  return (
    <div className="stream-interrupted" role="alert">
      <div className="stream-interrupted-text">
        <span aria-hidden="true">⚠</span>
        <span>
          {proxyUnavailable ? 'Needs your account link to reach this model' : 'Stream interrupted'}
        </span>
      </div>
      <div className="stream-interrupted-actions">
        <button
          type="button"
          data-action="retry"
          disabled={p.disabled || p.retryDisabled}
          title={p.retryDisabled ? (p.retryDisabledReason ?? undefined) : undefined}
          onClick={p.onRetry}
          className="ctrl-btn"
        >
          ↻ Retry
        </button>
        {p.retryDisabled && p.retryDisabledReason ? (
          <p className="stream-interrupted-reason">{p.retryDisabledReason}</p>
        ) : null}
        <button
          type="button"
          data-action="discard"
          disabled={p.disabled}
          onClick={p.onDiscard}
          className="ctrl-btn"
        >
          ⌫ Discard
        </button>
        {proxyUnavailable ? (
          <Link to="/app/account/server-linking" className="ctrl-btn">
            Open Server linking
          </Link>
        ) : null}
      </div>
      {p.onShowDiagnostics ? (
        <div className="stream-interrupted-diag">
          <button
            type="button"
            data-action="diagnostics"
            onClick={p.onShowDiagnostics}
            className="stream-interrupted-diag-link"
          >
            Show diagnostics
          </button>
          <span className="stream-interrupted-diag-hint">Copy this before reloading</span>
        </div>
      ) : null}
    </div>
  );
}
