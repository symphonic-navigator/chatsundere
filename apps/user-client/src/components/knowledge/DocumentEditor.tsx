// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getDocument, useUpdateDocument } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';

/** Full-document editor: title + content. A content change re-queues embedding. */
export function DocumentEditor(props: {
  libraryId: string;
  documentId: string;
  onClose: () => void;
}): JSX.Element | null {
  const doc = useQuery({
    queryKey: QK.document(props.documentId),
    queryFn: () => getDocument(props.documentId),
  });
  const update = useUpdateDocument(props.libraryId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (doc.data && !loaded) {
      setTitle(doc.data.title);
      setContent(doc.data.content);
      setLoaded(true);
    }
  }, [doc.data, loaded]);

  if (!doc.data) return null;

  const save = (): void => {
    const patch: { title?: string; content?: string } = {};
    if (title !== doc.data?.title) patch.title = title;
    if (content !== doc.data?.content) patch.content = content;
    if (patch.title !== undefined || patch.content !== undefined) {
      update.mutate({ id: props.documentId, patch });
    }
    props.onClose();
  };

  return (
    <div className="sheet-root knowledge-sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={props.onClose} />
      <dialog open className="sheet-panel" aria-label="Edit document">
        <label className="sheet-field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sheet-field">
          <span>Content</span>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} />
        </label>
        <div className="sheet-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
        </div>
      </dialog>
    </div>
  );
}
