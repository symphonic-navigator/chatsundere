// SPDX-License-Identifier: AGPL-3.0-only
import { getClientDataDb } from '../boot/client-data-db.js';
import { useCurrentChatStore } from '../state/current-chat.store.js';
import { useStreamManagerStore } from '../state/stream-manager.store.js';
import { toastStore } from '../state/toast.store.js';

interface PanicArgs {
  navigate: (to: string) => void;
}

/**
 * Phase-3.2 NSFW Panic auto-kick. Called when the user toggles
 * Adult Mode from 'nsfw' to 'sfw'. Aborts every in-flight stream
 * against an `adultPersona`-marked persona (preserve semantics —
 * the partial draft persona-message is written back as
 * `streamingState: 'incomplete'` so the StreamInterruptedFooter
 * can offer Retry/Discard on re-visit; the user-message stays
 * untouched). If the user happens to be inside one of those chats,
 * navigates them to the Entrance Hall and surfaces a brief toast.
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
  if (!activeChatId) return;

  const activeChat = await db.chats.get(activeChatId);
  if (!activeChat) return;
  if (!adultPersonaIds.includes(activeChat.personaId)) return;

  args.navigate('/app');
  toastStore.show({
    message: 'Adult mode off — chat closed',
    tone: 'warn',
    durationMs: 3500,
  });
}
