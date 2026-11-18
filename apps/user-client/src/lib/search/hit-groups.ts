// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow } from '../../boot/client-data-db.js';
import { displayTitle } from '../chat-title.js';
import type { Snippet } from './message-snippet.js';
import type { MessageHit } from './scan-messages.js';

/** One hit as the result list renders it, independent of where it came from (spec §7.2). */
export interface SearchHit {
  key: string;
  roleLabel: string;
  date: number;
  snippet: Snippet;
  href: string;
}

/** The hits of one chat, as the result list renders them (spec §7.2). */
export interface SearchHitGroup {
  key: string;
  title: string;
  personaId: string | null;
  hits: SearchHit[];
  totalHits: number;
}

/** The persona fields a group needs to label its hits. */
export interface HitPersona {
  id: string;
  name: string;
}

/**
 * Group message hits by chat, in the order the chats first appear (the scan
 * order). Groups whose chat is gone from the live, gated list — or whose
 * persona is not visible — are dropped; titles come from the live chat.
 */
export function toHitGroups(
  hits: readonly MessageHit[],
  liveChatsById: ReadonlyMap<string, ChatRow>,
  personaById: ReadonlyMap<string, HitPersona>,
): SearchHitGroup[] {
  const groups = new Map<string, SearchHitGroup>();
  for (const hit of hits) {
    const chat = liveChatsById.get(hit.chatId);
    if (!chat) continue;
    const persona = personaById.get(chat.personaId);
    if (!persona) continue;
    let group = groups.get(chat.id);
    if (!group) {
      group = {
        key: chat.id,
        title: displayTitle(chat),
        personaId: persona.id,
        hits: [],
        totalHits: 0,
      };
      groups.set(chat.id, group);
    }
    group.hits.push({
      key: hit.messageId,
      roleLabel: hit.role === 'user' ? 'You' : persona.name,
      date: hit.createdAt,
      snippet: hit.snippet,
      href: `/app/chat/${chat.id}?focus=${hit.messageId}`,
    });
    group.totalHits++;
  }
  return [...groups.values()];
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** A hit's date: `3 Nov`, with the year added outside the current year. */
export function hitDateLabel(ms: number, now: number = Date.now()): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(ms);
}
