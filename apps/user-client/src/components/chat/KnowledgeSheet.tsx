// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { useFilteredLibraries } from '../../data/knowledge.js';

interface Props {
  /** Libraries assigned by the active persona — shown locked-on (transparency). */
  personaLibraryIds: string[];
  /** Ad-hoc libraries bound to this chat only — toggleable. */
  chatLibraryIds: string[];
  /** Toggle a non-persona library's membership in the chat's ad-hoc set. */
  onToggleChat: (id: string) => void;
  /**
   * Whether the active persona is an adult persona. An SFW persona is never
   * offered NSFW libraries to bind, even when the global adult mode is on
   * (NSFW gating layer 1, applied on top of the global-mode filter).
   */
  adultPersona: boolean;
  /**
   * Whether an active chat exists to bind libraries to. When false, the
   * toggleable (non-persona) rows render disabled with an explanatory tooltip
   * rather than silently inert. Defaults to true.
   */
  canBindChat?: boolean;
  onClose: () => void;
}

/**
 * Bottom-sheet that binds knowledge libraries to the current send. Persona-
 * assigned libraries are rendered locked-on (checked + disabled) so the user can
 * always see what the persona contributes without being able to silently strip
 * it — the remaining (already NSFW-filtered) libraries are freely toggleable for
 * this chat only. Empty list → a link into the knowledge manager.
 */
export function KnowledgeSheet(p: Props): JSX.Element {
  const libraries = (useFilteredLibraries().data ?? []).filter((l) => p.adultPersona || !l.nsfw);
  const personaSet = new Set(p.personaLibraryIds);
  const chatSet = new Set(p.chatLibraryIds);
  const canBindChat = p.canBindChat ?? true;

  return (
    <div className="knowledge-sheet-root">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop is a dismiss surface; Close is the keyboard path */}
      <div className="knowledge-backdrop" data-testid="knowledge-backdrop" onClick={p.onClose} />
      <aside className="knowledge-sheet" aria-label="Knowledge for this chat">
        <header className="knowledge-sheet-header">
          <span className="knowledge-sheet-title">Knowledge</span>
          <button
            type="button"
            className="knowledge-sheet-close"
            aria-label="Close knowledge"
            onClick={p.onClose}
          >
            ✕
          </button>
        </header>
        {libraries.length === 0 ? (
          <p className="knowledge-sheet-empty">
            No libraries yet. Create one in{' '}
            <Link to="/app/knowledge" onClick={p.onClose}>
              My Knowledge
            </Link>
            .
          </p>
        ) : (
          <ul className="knowledge-sheet-list">
            {libraries.map((library) => {
              const fromPersona = personaSet.has(library.id);
              const checked = fromPersona || chatSet.has(library.id);
              const lockedNoChat = !fromPersona && !canBindChat;
              return (
                <li key={library.id} className="knowledge-sheet-item">
                  <label className="knowledge-sheet-row">
                    <input
                      type="checkbox"
                      aria-label={library.name}
                      checked={checked}
                      disabled={fromPersona || lockedNoChat}
                      title={
                        lockedNoChat
                          ? 'Send your first message to add libraries to this chat.'
                          : undefined
                      }
                      onChange={() => {
                        if (!fromPersona && canBindChat) p.onToggleChat(library.id);
                      }}
                    />
                    <span className="knowledge-sheet-name">{library.name}</span>
                    {fromPersona ? (
                      <span className="knowledge-sheet-hint">from persona</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
