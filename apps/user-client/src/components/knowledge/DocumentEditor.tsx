// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getDocument, useDocuments, useUpdateDocument } from '../../data/knowledge.js';
import { QK } from '../../data/queryKeys.js';
import { normalisePhrases } from '../../lib/treasury-filter.js';
import { TagEditor } from '../artefact/TagEditor.js';

/** Full-document editor: title, content, trigger phrases and the companion
 *  toggle. A content change re-queues embedding; phrase/toggle changes do not. */
export function DocumentEditor(props: {
  libraryId: string;
  documentId: string;
  onClose: () => void;
}): JSX.Element | null {
  const doc = useQuery({
    queryKey: QK.document(props.documentId),
    queryFn: () => getDocument(props.documentId),
  });
  const siblings = useDocuments(props.libraryId);
  const update = useUpdateDocument(props.libraryId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [phrases, setPhrases] = useState<string[]>([]);
  const [triggerOnCompanion, setTriggerOnCompanion] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (doc.data && !loaded) {
      setTitle(doc.data.title);
      setContent(doc.data.content);
      setPhrases(doc.data.triggerPhrases);
      setTriggerOnCompanion(doc.data.triggerOnCompanion ?? false);
      setLoaded(true);
    }
  }, [doc.data, loaded]);

  if (!doc.data) return null;

  // Phrases used by OTHER documents in the same library — lightweight reuse.
  const suggestions = Array.from(
    new Set(
      (siblings.data ?? [])
        .filter((d) => d.id !== props.documentId)
        .flatMap((d) => d.triggerPhrases),
    ),
  );

  const save = (): void => {
    const patch: {
      title?: string;
      content?: string;
      triggerPhrases?: string[];
      triggerOnCompanion?: boolean;
    } = {};
    if (title !== doc.data?.title) patch.title = title;
    if (content !== doc.data?.content) patch.content = content;
    const nextPhrases = normalisePhrases(phrases);
    if (JSON.stringify(nextPhrases) !== JSON.stringify(doc.data?.triggerPhrases)) {
      patch.triggerPhrases = nextPhrases;
    }
    if (triggerOnCompanion !== (doc.data?.triggerOnCompanion ?? false)) {
      patch.triggerOnCompanion = triggerOnCompanion;
    }
    if (Object.keys(patch).length > 0) update.mutate({ id: props.documentId, patch });
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
        <div className="sheet-field">
          <span>Trigger phrases</span>
          <TagEditor
            mode="edit"
            value={phrases}
            suggestions={suggestions}
            onChange={setPhrases}
            normalise={normalisePhrases}
          />
        </div>
        <label className="sheet-field sheet-field-inline">
          <input
            type="checkbox"
            checked={triggerOnCompanion}
            disabled={phrases.length === 0}
            onChange={(e) => setTriggerOnCompanion(e.target.checked)}
            title={
              phrases.length === 0
                ? 'Add a trigger phrase first'
                : "Also scan the companion's last message for these phrases"
            }
          />
          <span>Let the companion trigger this too</span>
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
