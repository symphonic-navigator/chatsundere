// SPDX-License-Identifier: AGPL-3.0-only
import { BookOpen } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useChat, useSetChatLibraries } from '../../../data/chats.js';
import { useFilteredLibraries } from '../../../data/knowledge.js';
import { usePersona } from '../../../data/personas.js';

/**
 * Full-page view of the knowledge libraries bound to this chat.
 * Persona-assigned libraries are locked-on (checked + disabled); the
 * remaining (NSFW-filtered) libraries are freely toggleable for this chat.
 *
 * The row treatment mirrors the persona-editor KnowledgeSection so the two
 * library surfaces look identical; behaviour stays checkbox-based here because
 * the chat binding distinguishes locked-on persona rows from toggleable ones.
 */
export function KnowledgePage(): JSX.Element {
  const { chatId = '' } = useParams();
  const { onHelp, helpOverlay } = useHelp('chat-knowledge');
  const { data: chatData } = useChat(chatId !== '' ? chatId : null);
  const personaId = chatData?.chat.personaId ?? '';
  const { data: persona } = usePersona(personaId !== '' ? personaId : null);
  const setChatLibraries = useSetChatLibraries();

  const adultPersona = persona?.adultPersona ?? false;
  const personaLibraryIds = persona?.libraryIds ?? [];
  const chatLibraryIds = chatData?.chat.libraryIds ?? [];
  // No chat row yet (direct URL before first send): toggleable rows can't bind
  // anywhere, so disable them with a reason rather than silently no-op. Fix 1's
  // cockpit gating makes this unreachable in the normal flow — belt-and-braces.
  const canBindChat = !!chatData?.chat;

  // Apply the persona-level NSFW gate on top of the global mode filter already
  // applied by useFilteredLibraries (SFW persona never sees NSFW libraries).
  const libraries = (useFilteredLibraries().data ?? []).filter((l) => adultPersona || !l.nsfw);

  const personaSet = new Set(personaLibraryIds);
  const chatSet = new Set(chatLibraryIds);

  function toggle(id: string): void {
    const next = chatLibraryIds.includes(id)
      ? chatLibraryIds.filter((l) => l !== id)
      : [...chatLibraryIds, id];
    setChatLibraries.mutate({ chatId, libraryIds: next });
  }

  return (
    <PageScaffold
      crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Knowledge' }]}
      back={`/app/chat/${chatId}`}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-6 px-4 pb-8 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-medium text-paper">
          <BookOpen size={18} aria-hidden="true" />
          Knowledge
        </h1>

        <p className="text-[11px] text-paper-soft">
          Choose which knowledge libraries this chat can draw on. Libraries assigned by the persona
          are always on.
        </p>

        {libraries.length === 0 ? (
          <p className="text-[11px] text-paper-soft">
            No libraries yet. Create one in{' '}
            <Link to="/app/knowledge" className="text-paper underline">
              My Knowledge
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {libraries.map((library) => {
              const fromPersona = personaSet.has(library.id);
              const checked = fromPersona || chatSet.has(library.id);
              const lockedNoChat = !fromPersona && !canBindChat;
              const locked = fromPersona || lockedNoChat;
              return (
                <li key={library.id}>
                  <label
                    className={`flex items-center justify-between gap-3 rounded-md border p-3 ${
                      locked
                        ? 'cursor-default border-white/5 bg-white/[0.02] opacity-70'
                        : 'cursor-pointer border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                    title={
                      lockedNoChat ? 'Send your first message to add to this chat.' : undefined
                    }
                  >
                    <div className="min-w-0">
                      <div className="font-display text-sm text-paper">{library.name}</div>
                      {fromPersona ? (
                        <div className="mt-0.5 text-[11px] text-paper-soft">from persona</div>
                      ) : null}
                    </div>
                    <input
                      type="checkbox"
                      aria-label={library.name}
                      checked={checked}
                      disabled={locked}
                      onChange={() => {
                        if (!fromPersona && canBindChat) toggle(library.id);
                      }}
                      className="h-4 w-4 shrink-0 accent-paper"
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <Link to="/app/knowledge" className="text-sm text-paper underline">
          Manage in My Knowledge
        </Link>
      </div>
    </PageScaffold>
  );
}
