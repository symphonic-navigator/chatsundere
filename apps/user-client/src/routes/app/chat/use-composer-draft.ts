// SPDX-License-Identifier: AGPL-3.0-only

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { loadLazyDraft, saveLazyDraft } from '../../../lib/cockpit-draft.js';

export const DRAFT_DEBOUNCE_MS = 250;

interface Args {
  isLazy: boolean;
  /** Lazy-mode key: the persona the not-yet-created chat belongs to. */
  personaId: string | null;
  activeChatId: string | null;
  /** The active chat's row as currently loaded (undefined/null while loading). */
  chatRow: { id: string; draftInput: string } | null | undefined;
  /** Chat-mode persistence of the draft to the chat row. */
  persist: (chatId: string, draft: string) => void;
  /** Lazy-mode save is skipped once eager chat creation has taken the draft over. */
  skipLazySave: () => boolean;
}

/**
 * The cockpit composer's draft. Chat mode persists to `ChatRow.draftInput`,
 * lazy mode to localStorage — both debounced.
 */
export function useComposerDraft(args: Args): [string, Dispatch<SetStateAction<string>>] {
  const { isLazy, personaId, activeChatId, chatRow } = args;
  const persistRef = useRef(args.persist);
  persistRef.current = args.persist;
  const skipLazySaveRef = useRef(args.skipLazySave);
  skipLazySaveRef.current = args.skipLazySave;

  const dbDraft = chatRow?.draftInput ?? '';
  const [draft, setDraft] = useState<string>(() =>
    isLazy && personaId ? loadLazyDraft(personaId) : '',
  );

  // The local draft is the source of truth while typing; the row is read once
  // per chat. Re-reading it on every change echoed each debounced save back
  // into the textarea, overwriting whatever was typed during the round-trip —
  // and resetting the value mid-composition made IME/autocorrect keyboards
  // drop whole words. `hydratedChatId` also gates saving, so a chat switch
  // never writes the previous chat's draft into the next one.
  const [hydratedChatId, setHydratedChatId] = useState<string | null>(null);
  const chatRowReady = !!chatRow && chatRow.id === activeChatId;
  useEffect(() => {
    if (isLazy || !activeChatId) {
      setHydratedChatId(null);
      return;
    }
    if (hydratedChatId === activeChatId) return;
    if (!chatRowReady) {
      setDraft('');
      return;
    }
    setDraft(dbDraft);
    setHydratedChatId(activeChatId);
  }, [isLazy, activeChatId, hydratedChatId, chatRowReady, dbDraft]);

  useEffect(() => {
    if (isLazy) {
      if (!personaId) return;
      const t = setTimeout(() => {
        if (skipLazySaveRef.current()) return;
        saveLazyDraft(personaId, draft);
      }, DRAFT_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }
    if (activeChatId && hydratedChatId === activeChatId && draft !== dbDraft) {
      const t = setTimeout(() => persistRef.current(activeChatId, draft), DRAFT_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [draft, isLazy, personaId, activeChatId, hydratedChatId, dbDraft]);

  return [draft, setDraft];
}
