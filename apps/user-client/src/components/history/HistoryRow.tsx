// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatRow, PersonaRow } from '../../boot/client-data-db.js';
import { displayTitle } from '../../lib/chat-title.js';
import { relativeTimeLabel } from '../../lib/relative-time.js';
import { StreamingOrb } from '../StreamingOrb.js';
import { HistoryRowConfirmTray } from './HistoryRowConfirmTray.js';
import { HistoryRowRenameInput } from './HistoryRowRenameInput.js';

interface Props {
  chat: ChatRow;
  persona: PersonaRow;
  onRename: (next: string | null) => void;
  onDelete: () => void;
}

export function HistoryRow({ chat, persona, onRename, onDelete }: Props): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm-delete'>('idle');

  if (mode === 'confirm-delete') {
    return (
      <li className="history-row relative rounded-lg">
        <StreamingOrb personaId={persona.id} colour={persona.colour} />
        <HistoryRowConfirmTray
          onCancel={() => setMode('idle')}
          onDelete={() => {
            setMode('idle');
            onDelete();
          }}
        />
      </li>
    );
  }

  return (
    <li className="history-row relative rounded-lg border border-white/5 bg-white/[0.02]">
      <StreamingOrb personaId={persona.id} colour={persona.colour} />
      <div className="flex items-stretch">
        {/* Row body — navigates to chat in idle mode; shows rename input in rename mode */}
        {mode === 'rename' ? (
          <div className="min-w-0 flex-1 px-3 py-2">
            <HistoryRowRenameInput
              initialValue={chat.title ?? ''}
              onCommit={(next) => {
                setMode('idle');
                onRename(next);
              }}
              onCancel={() => setMode('idle')}
            />
            <div className="history-row-meta text-xs text-paper-soft">
              <span style={{ color: persona.colour, opacity: 0.7 }}>{persona.name}</span>
              <span> · </span>
              <span>{relativeTimeLabel(chat.lastMessageAt)}</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-row-body
            onClick={() => navigate(`/app/chat/${chat.id}`)}
            className="min-w-0 flex-1 px-3 py-2 text-left"
          >
            <div className="truncate font-display text-base" style={{ color: persona.colour }}>
              {displayTitle(chat)}
            </div>
            <div className="history-row-meta text-xs text-paper-soft">
              <span style={{ color: persona.colour, opacity: 0.7 }}>{persona.name}</span>
              <span> · </span>
              <span>{relativeTimeLabel(chat.lastMessageAt)}</span>
            </div>
          </button>
        )}

        {/* Action icons — stopPropagation prevents row-body click bubbling */}
        <div className="flex shrink-0 items-center gap-1 pr-2">
          <button
            type="button"
            data-rename-btn
            aria-label="Rename chat"
            onClick={(e) => {
              e.stopPropagation();
              setMode('rename');
            }}
            className="grid h-8 w-8 place-items-center rounded-md text-paper-soft hover:text-paper"
          >
            🖎
          </button>
          <button
            type="button"
            data-delete-btn
            aria-label="Delete chat"
            onClick={(e) => {
              e.stopPropagation();
              setMode('confirm-delete');
            }}
            className="grid h-8 w-8 place-items-center rounded-md text-paper-soft hover:text-danger"
          >
            🗑
          </button>
        </div>
      </div>
    </li>
  );
}
