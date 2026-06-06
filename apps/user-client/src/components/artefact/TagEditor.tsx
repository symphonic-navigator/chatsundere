// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { normaliseTags } from '../../lib/treasury-filter.js';

interface Props {
  /** 'edit' = free-text add + remove; 'pick' = choose from suggestions only. */
  mode: 'edit' | 'pick';
  value: string[];
  /** Existing tags to autocomplete / offer. */
  suggestions: string[];
  onChange: (next: string[]) => void;
}

/**
 * Reusable tag editor. In edit mode the user types a tag and presses Enter;
 * input is normalised (trim+lowercase) and deduped. Suggestions matching the
 * current input are offered as quick-add buttons. In pick mode there is no free
 * text — only the not-yet-selected suggestions are offered.
 */
export function TagEditor({ mode, value, suggestions, onChange }: Props): JSX.Element {
  const [text, setText] = useState('');

  function add(tag: string): void {
    onChange(normaliseTags([...value, tag]));
    setText('');
  }
  function remove(tag: string): void {
    onChange(value.filter((t) => t !== tag));
  }

  const q = text.trim().toLowerCase();
  const offered =
    mode === 'pick'
      ? suggestions.filter((s) => !value.includes(s))
      : suggestions.filter((s) => !value.includes(s) && q !== '' && s.includes(q));

  return (
    <div className="tag-editor">
      <div className="tag-editor-chips">
        {value.map((t) => (
          <span key={t} className="tag-chip">
            <span className="tag-chip-label">#{t}</span>
            <button
              type="button"
              className="tag-chip-x"
              aria-label={`Remove tag ${t}`}
              onClick={() => remove(t)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      {mode === 'edit' ? (
        <input
          className="tag-editor-input"
          value={text}
          placeholder="Add a tag…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() !== '') add(text);
          }}
        />
      ) : null}
      {offered.length > 0 ? (
        <div className="tag-editor-suggestions">
          {offered.map((s) => (
            <button
              key={s}
              type="button"
              className="tag-suggestion"
              aria-label={`Add tag ${s}`}
              onClick={() => add(s)}
            >
              #{s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
