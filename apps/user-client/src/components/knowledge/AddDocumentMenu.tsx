// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { NewDocumentInput } from '../../data/knowledge.js';

/** Strip a trailing .md/.txt extension for a friendly default title. */
function titleFromFilename(name: string): string {
  return name.replace(/\.(md|markdown|txt)$/i, '');
}

/** Two-source document add: upload .md/.txt files, or paste a single document. */
export function AddDocumentMenu(props: { onAdd: (docs: NewDocumentInput[]) => void }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList): Promise<void> => {
    const docs: NewDocumentInput[] = [];
    for (const file of Array.from(files)) {
      docs.push({ title: titleFromFilename(file.name), content: await file.text() });
    }
    if (docs.length > 0) props.onAdd(docs);
  };

  return (
    <div className="add-document">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
        Add document
      </button>
      {menuOpen ? (
        <div className="add-document-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              fileInputRef.current?.click();
            }}
          >
            Upload files
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setPasteOpen(true);
            }}
          >
            Paste text
          </button>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="sheet-root knowledge-sheet-root">
          <button
            type="button"
            className="sheet-backdrop"
            aria-label="Close"
            onClick={() => setPasteOpen(false)}
          />
          <dialog open className="sheet-panel" aria-label="Paste document">
            <label className="sheet-field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="sheet-field">
              <span>Content</span>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
            </label>
            <div className="sheet-actions">
              <button type="button" onClick={() => setPasteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={content.trim().length === 0}
                onClick={() => {
                  props.onAdd([{ title, content }]);
                  setTitle('');
                  setContent('');
                  setPasteOpen(false);
                }}
              >
                Add
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
