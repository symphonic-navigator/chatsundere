// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatRow, PersonaRow } from '../../boot/client-data-db.js';
import { useChatArtefactCount } from '../../data/artefacts.js';
import { displayTitle } from '../../lib/chat-title.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';
import { PersonaAvatar } from '../PersonaAvatar.js';
import { StreamingOrb } from '../StreamingOrb.js';
import { Badge } from '../ui/Badge.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { HistoryRowRenameInput } from './HistoryRowRenameInput.js';

interface Props {
  chat: ChatRow;
  persona: PersonaRow;
  onRename: (next: string | null) => void;
  onDelete: () => void;
}

/**
 * One chat in My History, in the shared `cs-row` grammar: persona avatar leading
 * (with the live-stream orb pinned to its corner), the chat title (1px under the
 * row default) over `persona · age`, then an NSFW badge (adult personas only) +
 * a `⋯` menu trailing. Every secondary action — rename, new chat, go to persona,
 * delete — lives in the menu so the row body stays a single tap into the chat.
 */
export function HistoryRow({ chat, persona, onRename, onDelete }: Props): JSX.Element {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Only fetch the artefact count while the delete dialog is open — avoids
  // loading artefact content for every row just to render a warning count.
  const artefactCountQuery = useChatArtefactCount(chat.id, confirmDelete);
  const artefactCount = artefactCountQuery.data ?? 0;

  const leading = (
    <span className="cs-row-leading">
      <span className="history-avatar">
        <PersonaAvatar
          personaId={persona.id}
          name={persona.name}
          colour={persona.colour}
          size={40}
        />
        <StreamingOrb personaId={persona.id} colour={persona.colour} />
      </span>
    </span>
  );
  const subtitle = (
    <span className="cs-row-subtitle">
      <span style={{ color: persona.colour, opacity: 0.8 }}>{persona.name}</span>
      {' · '}
      {relativeTimeLabel(chat.lastMessageAt)}
    </span>
  );

  return (
    <div className="cs-row" data-history-row={chat.id}>
      {renaming ? (
        <div className="cs-row-main" data-static>
          {leading}
          <span className="cs-row-body">
            <HistoryRowRenameInput
              initialValue={chat.title ?? ''}
              onCommit={(next) => {
                setRenaming(false);
                onRename(next);
              }}
              onCancel={() => setRenaming(false)}
            />
            {subtitle}
          </span>
        </div>
      ) : (
        <button
          type="button"
          data-row-body
          className="cs-row-main"
          onClick={() => navigate(`/app/chat/${chat.id}`)}
        >
          {leading}
          <span className="cs-row-body">
            <span className="cs-row-title" data-compact style={{ color: persona.colour }}>
              {displayTitle(chat)}
            </span>
            {subtitle}
          </span>
        </button>
      )}

      <span className="cs-row-trailing">
        {persona.adultPersona ? <Badge tone="danger">NSFW</Badge> : null}
        <OverflowMenu
          triggerLabel="Chat actions"
          items={[
            { label: 'Rename', onSelect: () => setRenaming(true) },
            {
              label: 'New chat with this persona',
              onSelect: () => navigate(`/app/chat/new?personaId=${persona.id}`),
            },
            {
              label: 'Go to persona',
              onSelect: () =>
                navigate(
                  `/app/persona/${persona.id}?return=${encodeURIComponent(
                    `/app/history?personaId=${persona.id}`,
                  )}`,
                ),
            },
            { label: 'Delete', tone: 'destructive', onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </span>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this chat?"
        body={
          artefactCount > 0
            ? `This will also delete ${artefactCount} artefact${artefactCount === 1 ? '' : 's'}. This cannot be undone.`
            : 'This cannot be undone.'
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
      />
    </div>
  );
}
