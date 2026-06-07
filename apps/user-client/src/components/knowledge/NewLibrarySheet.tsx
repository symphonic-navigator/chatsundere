// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

export interface NewLibraryValue {
  name: string;
  description: string;
  nsfw: boolean;
}

/** Bottom-sheet form for creating or editing a library. */
export function LibrarySheet(props: {
  initial?: NewLibraryValue;
  title: string;
  submitLabel: string;
  onSubmit: (value: NewLibraryValue) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [description, setDescription] = useState(props.initial?.description ?? '');
  const [nsfw, setNsfw] = useState(props.initial?.nsfw ?? false);
  const canSubmit = name.trim().length > 0;
  return (
    <div className="sheet-root knowledge-sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={props.onClose} />
      <dialog className="sheet-panel" aria-label={props.title} open>
        <label className="sheet-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="sheet-field">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="sheet-toggle">
          <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
          <span>Adult (NSFW)</span>
        </label>
        <div className="sheet-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              props.onSubmit({ name: name.trim(), description: description.trim(), nsfw })
            }
          >
            {props.submitLabel}
          </button>
        </div>
      </dialog>
    </div>
  );
}

/**
 * Convenience alias kept for backwards compatibility with the create-only
 * call-site in knowledge.tsx.
 * @deprecated Use LibrarySheet directly.
 */
export const NewLibrarySheet = LibrarySheet;
