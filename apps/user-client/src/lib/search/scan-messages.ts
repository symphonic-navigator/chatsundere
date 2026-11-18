// SPDX-License-Identifier: AGPL-3.0-only
import Dexie from 'dexie';
import { openClientDataDb } from '../../boot/client-data-db.js';
import { queryWords } from './fold.js';
import { type Snippet, displayedText, matchMessage, rawCandidate } from './message-snippet.js';

/** The scan stops after this many message hits (spec §8.3). */
export const MESSAGE_HIT_CAP = 300;
/** Hits and progress reach the caller at most this often, and once at the end. */
const FLUSH_MS = 100;

export interface ScanChat {
  id: string;
  personaId: string;
  title: string;
}

export interface MessageHit {
  chatId: string;
  messageId: string;
  role: 'user' | 'persona';
  createdAt: number;
  snippet: Snippet;
}

export interface ScanProgress {
  scannedChats: number;
  totalChats: number;
  hits: number;
  capped: boolean;
  done: boolean;
  /** Index into the chat list of the next chat to scan: the resume point. */
  nextIndex: number;
}

/** Hands the main thread back between chats so typing and taps stay responsive. */
function yieldToMain(): Promise<void> {
  // `scheduler` is not in TypeScript's DOM lib yet.
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Scan the given chats' messages, in list order, for `query`, streaming hits
 * and progress in batches. Only the ids in `chats` are ever read — the
 * visibility gate is the caller's list. Returns silently, with no further
 * callbacks, once `signal` aborts.
 */
export async function scanMessages(args: {
  chats: readonly ScanChat[];
  query: string;
  startIndex?: number;
  cap?: number;
  initialHits?: number;
  signal: AbortSignal;
  onHits: (hits: MessageHit[]) => void;
  onProgress: (p: ScanProgress) => void;
}): Promise<void> {
  const { chats, signal, onHits, onProgress } = args;
  const cap = args.cap ?? MESSAGE_HIT_CAP;
  const words = queryWords(args.query);
  const totalChats = chats.length;
  let index = Math.max(0, Math.min(args.startIndex ?? 0, totalChats));
  let total = args.initialHits ?? 0;
  let pending: MessageHit[] = [];
  let lastFlush = Date.now();

  const flush = (capped: boolean, done: boolean): void => {
    if (pending.length > 0) {
      const batch = pending;
      pending = [];
      onHits(batch);
    }
    onProgress({ scannedChats: index, totalChats, hits: total, capped, done, nextIndex: index });
    lastFlush = Date.now();
  };

  if (signal.aborted) return;
  if (words.length === 0 || total >= cap) {
    flush(total >= cap && words.length > 0, true);
    return;
  }
  flush(false, false);

  const db = await openClientDataDb();
  while (index < totalChats) {
    if (signal.aborted) return;
    const chat = chats[index];
    if (!chat) break;
    const rows = await db.messages
      .where('[chatId+createdAt]')
      .between([chat.id, Dexie.minKey], [chat.id, Dexie.maxKey])
      .toArray();
    if (signal.aborted) return;

    let capped = false;
    for (const row of rows) {
      if (row.role === 'system') continue;
      if (!rawCandidate(row.contentBlocks, words)) continue;
      const snippet = matchMessage(displayedText(row.contentBlocks), words);
      if (!snippet) continue;
      pending.push({
        chatId: chat.id,
        messageId: row.id,
        role: row.role,
        createdAt: row.createdAt,
        snippet,
      });
      total++;
      if (total >= cap) {
        capped = true;
        break;
      }
    }
    index++;

    if (capped) {
      flush(true, true);
      return;
    }
    if (Date.now() - lastFlush >= FLUSH_MS) flush(false, false);
    if (index < totalChats) {
      await yieldToMain();
    }
  }
  if (signal.aborted) return;
  flush(false, true);
}
