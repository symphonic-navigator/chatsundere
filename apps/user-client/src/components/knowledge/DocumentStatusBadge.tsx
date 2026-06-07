// SPDX-License-Identifier: AGPL-3.0-only
import type { EmbeddingStatus } from '../../boot/client-data-db.js';

const LABEL: Record<EmbeddingStatus, string> = {
  pending: 'Pending',
  embedding: 'Embedding…',
  ready: 'Ready',
  failed: 'Failed',
};

/** Inline status pill for a document; failed documents expose a Retry. */
export function DocumentStatusBadge(props: {
  status: EmbeddingStatus;
  onRetry: () => void;
}): JSX.Element {
  return (
    <span className="doc-status" data-status={props.status}>
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
