// SPDX-License-Identifier: AGPL-3.0-only
import { Gem } from 'lucide-react';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { ArtefactRow } from '../../../boot/client-data-db.js';
import { Lightbox } from '../../../components/lightbox/Lightbox.js';
import { artefactToViewable } from '../../../components/lightbox/viewable-item.js';
import { TreasuryRow } from '../../../components/treasury/TreasuryRow.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  useChatArtefacts,
  useDeleteArtefact,
  useRenameArtefact,
  useSetArtefactFavourite,
  useSetArtefactTags,
  useUpdateArtefactContent,
} from '../../../data/artefacts.js';
import { useChat } from '../../../data/chats.js';
import { usePersona } from '../../../data/personas.js';
import { buildArtefactSections } from '../../../lib/artefact-sections.js';
import { collectTags } from '../../../lib/treasury-filter.js';
import { useCurrentChatStore } from '../../../state/current-chat.store.js';

/** This chat's artefacts (code, documents, images) generated during the conversation. */
export function ArtefactsPage(): JSX.Element {
  const { chatId = '' } = useParams();
  const { onHelp, helpOverlay } = useHelp('chat-artefacts');

  const { data: rows = [] } = useChatArtefacts(chatId);
  const setFav = useSetArtefactFavourite(chatId);
  const renameArtefact = useRenameArtefact(chatId);
  const editArtefactContent = useUpdateArtefactContent(chatId);
  const removeArtefact = useDeleteArtefact(chatId);
  const setArtefactTags = useSetArtefactTags();

  const openArtefactId = useCurrentChatStore((s) => s.openArtefactId);
  const openArtefact = useCurrentChatStore((s) => s.openArtefact);
  const closeArtefact = useCurrentChatStore((s) => s.closeArtefact);

  // Derive the persona from the chat row directly: chat-page clears the store
  // chatHeader on unmount, and navigating here unmounts chat-page — so the
  // store would read null and every row would show "—".
  const { data: chatData } = useChat(chatId !== '' ? chatId : null);
  const { data: persona } = usePersona(chatData?.chat.personaId ?? null);
  const personaName = persona?.name ?? '—';
  const personaColour = persona?.colour ?? '#8d6dff';

  const sections = buildArtefactSections(rows);
  const items = useMemo(() => rows.map(artefactToViewable), [rows]);
  const openIndex =
    openArtefactId !== null ? items.findIndex((item) => item.id === openArtefactId) : -1;

  const renderRow = (r: ArtefactRow): JSX.Element => (
    <TreasuryRow
      key={r.id}
      row={r}
      personaName={personaName}
      personaColour={personaColour}
      selectMode={false}
      selected={false}
      onOpen={openArtefact}
      onToggleSelect={() => undefined}
      onToggleFavourite={(id) => setFav.mutate({ id, favourite: !r.favourite })}
    />
  );

  return (
    <PageScaffold
      crumbs={[{ label: 'Chat', to: `/app/chat/${chatId}` }, { label: 'Artefacts' }]}
      back={`/app/chat/${chatId}`}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="flex min-h-[60dvh] flex-col gap-2 px-4 pb-24 pt-3">
        <h1 className="flex items-center gap-2 text-lg font-medium text-paper">
          <Gem size={18} aria-hidden="true" />
          Artefacts
        </h1>

        {sections.favourites.length > 0 ? (
          <section className="artefact-section">
            <h3 className="artefact-section-title">★ Favourites</h3>
            <div className="flex flex-col gap-2">{sections.favourites.map(renderRow)}</div>
          </section>
        ) : null}

        <section className="artefact-section">
          <h3 className="artefact-section-title">In this chat</h3>
          {sections.inChat.length > 0 ? (
            <div className="flex flex-col gap-2">{sections.inChat.map(renderRow)}</div>
          ) : (
            <p className="artefact-empty">Artefacts you create appear here.</p>
          )}
        </section>
      </div>

      {openArtefactId !== null && openIndex >= 0 ? (
        <Lightbox
          items={items}
          index={openIndex}
          getOriginRect={(id) =>
            document
              .querySelector<HTMLElement>(`[data-treasury-row="${CSS.escape(id)}"]`)
              ?.getBoundingClientRect() ?? null
          }
          tagSuggestions={collectTags(rows)}
          onSetTags={(id, tags) => setArtefactTags.mutate({ id, tags })}
          onRename={(id, patch) => renameArtefact.mutate({ id, patch })}
          onRemove={() => {}}
          onEditText={(id, text) => editArtefactContent.mutate({ id, content: text })}
          onDelete={(id) => {
            removeArtefact.mutate(id);
            closeArtefact();
          }}
          onClose={closeArtefact}
        />
      ) : null}
    </PageScaffold>
  );
}
