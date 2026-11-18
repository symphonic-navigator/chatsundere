// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
import { useCurrentChatStore } from '../state/current-chat.store.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';
import { toastStore } from '../state/toast.store.js';

interface PanicArgs {
  /** Clears the way back and lands on the target (`useAppNav().resetTo`). */
  resetTo: (to: string) => void;
  /** The pathnames behind the current page (`useAppNav().trail`). */
  trail: () => readonly string[];
}

/** The toast shown whenever adult mode closes a chat. */
export const ADULT_CHAT_CLOSED = 'Adult mode off — chat closed';

const CHAT_PATH = /^\/app\/chat\/([^/]+)/;

/**
 * Phase-3.2 NSFW Panic auto-kick. Called when the user toggles
 * Adult Mode from 'nsfw' to 'sfw'. Aborts every in-flight stream
 * against an `adultPersona`-marked persona (preserve semantics —
 * the partial draft persona-message is written back as
 * `streamingState: 'incomplete'` so the StreamInterruptedFooter
 * can offer Retry/Discard on re-visit; the user-message stays
 * untouched). If the user is inside one of those chats, or one of them is
 * anywhere on the way back, clears the way back to the Entrance Hall (so Back
 * can never reopen it) and surfaces a brief toast.
 *
 * No-op when no adult personas exist or none are streaming and
 * the active chat is unrelated.
 */
export async function nsfwPanic(args: PanicArgs): Promise<void> {
  const db = getClientDataDb();

  const adultPersonas = await db.personas.filter((p) => p.adultPersona === true).toArray();
  const adultPersonaIds = adultPersonas.map((p) => p.id);
  if (adultPersonaIds.length === 0) return;

  const mgr = useStreamManagerStore.getState();
  for (const pid of adultPersonaIds) {
    await mgr.abortAllForPersonaPreserve(pid);
  }

  const activeChatId = useCurrentChatStore.getState().chatId;
  const behind = args
    .trail()
    .map((p) => CHAT_PATH.exec(p)?.[1])
    .filter((id): id is string => id !== undefined);
  const chatIds = [...new Set([...(activeChatId ? [activeChatId] : []), ...behind])];
  if (chatIds.length === 0) return;

  const chats = await db.chats.bulkGet(chatIds);
  const hidesAdult = chats.some((c) => c !== undefined && adultPersonaIds.includes(c.personaId));
  if (!hidesAdult) return;

  args.resetTo('/app');
  toastStore.show({
    message: ADULT_CHAT_CLOSED,
    tone: 'warn',
    durationMs: 3500,
  });
}
