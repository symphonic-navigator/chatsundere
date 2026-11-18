// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useChat } from '../data/chats.js';
import { usePersonas } from '../data/personas.js';
import { QK } from '../data/queryKeys.js';
import { useSettings } from '../data/settings.js';
import { ADULT_CHAT_CLOSED } from '../lib/nsfw-panic.js';
import { useAppNav } from '../lib/use-app-nav.js';
import { toastStore } from '../state/toast.store.js';

/**
 * Keeps an adult persona's chat, and its sub-pages, closed while Adult Mode is
 * SFW (spec "Back means one thing", Q2): a Forward, a stale tab or a chat's
 * Bookmarks page can no longer show what the panic hid. It renders nothing only
 * while it cannot yet tell; with the chat and persona in the query cache (the
 * normal case) the page is in the first render, so no chat opens later than before.
 */
export function AdultChatGuard(): JSX.Element | null {
  const { chatId } = useParams();
  const settings = useSettings();
  const chat = useChat(chatId ?? null);
  const personas = usePersonas();
  const nav = useAppNav();

  const mode = settings.data?.adultMode ?? (settings.isPending ? null : 'nsfw');
  // The persona list is cached app-wide; with no adult persona at all there is
  // nothing to hide and nothing to wait for, even before the chat itself loads.
  const anyAdult = personas.data?.some((p) => p.adultPersona) ?? null;
  // Before the chat itself loads, the chat list (cached by the Hall and History)
  // already names its persona, so an ordinary chat is not held back.
  const listed = useQueryClient()
    .getQueryData<Array<{ id: string; personaId: string }>>(QK.chats)
    ?.find((c) => c.id === chatId)?.personaId;
  const personaId = chat.data?.chat.personaId ?? listed;
  const adult =
    chatId === undefined || chat.data === null || anyAdult === false
      ? false
      : personaId === undefined || personas.data === undefined
        ? null
        : personas.data.some((p) => p.id === personaId && p.adultPersona);
  // A chat or persona list it cannot read stays closed, but leads to the Hall
  // rather than a blank page: on a chat route there is no ‹ to leave by.
  const unreadable = mode === 'sfw' && adult === null && (chat.isError || personas.isError);
  const hidden = mode === 'sfw' && (adult === true || unreadable);
  const unknown = mode === null || (mode === 'sfw' && adult === null);

  useEffect(() => {
    if (!hidden) return;
    if (nav.resetTo('/app')) {
      toastStore.show({
        message: unreadable ? "Couldn't open this chat." : ADULT_CHAT_CLOSED,
        tone: 'warn',
        durationMs: 3500,
      });
    }
  }, [hidden, unreadable, nav]);

  if (hidden || unknown) return null;
  return <Outlet />;
}
