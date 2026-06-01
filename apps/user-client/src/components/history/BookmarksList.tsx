// SPDX-License-Identifier: AGPL-3.0-only
import type { BookmarkGroup } from '../../data/bookmarks.js';
import { displayTitle } from '../../lib/chat-title.js';

interface Props {
  groups: BookmarkGroup[];
  /** Navigate into a chat focused on a message. */
  onJump: (chatId: string, messageId: string) => void;
}

/** Global bookmarks, grouped by chat (most-recently-active first). */
export function BookmarksList(p: Props): JSX.Element {
  if (p.groups.length === 0) {
    return (
      <div className="mt-8 grid place-items-center text-center text-paper-soft">
        <p className="font-display text-lg italic text-paper">No bookmarks yet.</p>
        <p className="mt-2 max-w-xs text-sm">Star a message in any chat to find it here.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {p.groups.map((g) => (
        <li key={g.chat.id} className="bookmark-group">
          <h3
            className="bookmark-group-title"
            style={g.persona?.colour ? { color: g.persona.colour } : undefined}
          >
            {displayTitle(g.chat)}
          </h3>
          <ul className="bookmark-group-list">
            {g.bookmarks.map((b) => (
              <li key={b.message.id}>
                <button
                  type="button"
                  className="bookmark-row"
                  data-role={b.message.role}
                  onClick={() => p.onJump(g.chat.id, b.message.id)}
                >
                  {b.label}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
