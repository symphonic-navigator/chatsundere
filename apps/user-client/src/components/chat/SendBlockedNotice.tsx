// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import type { SendBlockNote } from '../../data/send-errors.js';

interface Props {
  note: SendBlockNote;
  onDismiss: () => void;
}

/**
 * In-stream notice for a regenerate or an interrupted-reply Retry that stopped
 * before any request was built (a key that can't be opened, no master key). It
 * sits in the stream under the last reply, so it shows in reading mode too,
 * where there is no cockpit to carry a note.
 */
export function SendBlockedNotice(p: Props): JSX.Element {
  return (
    <div className="stream-interrupted send-blocked-notice" role="alert">
      <div className="stream-interrupted-text">
        <span aria-hidden="true">⚠</span>
        <span>{p.note.message}</span>
      </div>
      <div className="stream-interrupted-actions">
        <Link to={p.note.to} className="ctrl-btn">
          {p.note.actionLabel}
        </Link>
        <button type="button" onClick={p.onDismiss} className="ctrl-btn">
          Dismiss
        </button>
      </div>
    </div>
  );
}
