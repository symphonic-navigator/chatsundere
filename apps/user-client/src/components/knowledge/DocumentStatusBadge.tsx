// SPDX-License-Identifier: AGPL-3.0-only
import type { EmbeddingStatus } from '../../boot/client-data-db.js';

const LABEL: Record<EmbeddingStatus, string> = {
  pending: 'Pending',
  embedding: 'Embedding…',
  ready: 'Ready',
  failed: 'Failed',
};

/** Inline status pill for a document; failed documents expose a Retry and, on
 *  hover, the underlying error message as a tooltip. */
export function DocumentStatusBadge(props: {
  status: EmbeddingStatus;
  onRetry: () => void;
  /** The embedding error, shown as a tooltip on the failed pill. */
  error?: string | null;
}): JSX.Element {
  return (
    <span
      className="doc-status"
      data-status={props.status}
      title={props.status === 'failed' ? (props.error ?? undefined) : undefined}
    >
      {LABEL[props.status]}
      {props.status === 'failed' ? (
        <button
          type="button"
          className="doc-status-retry"
          onClick={(e) => {
            e.stopPropagation();
            props.onRetry();
          }}
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
