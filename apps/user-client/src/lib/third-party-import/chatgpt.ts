// SPDX-License-Identifier: AGPL-3.0-only

import type { DroppedCounts } from '../chatsune-import/dropped-hint.js';
import { chatGptSecondsToMs } from './time.js';
import {
  type FailedConversation,
  type ParseResult,
  type ThirdPartyConversation,
  type ThirdPartyMessage,
  isRecord,
  zeroDropped,
} from './types.js';

const KEEPABLE_ROLES = new Set(['user', 'assistant']);
const KEEPABLE_STATUS = new Set([null, undefined, 'finished_successfully']);

function addDropped(into: DroppedCounts, from: DroppedCounts): void {
  into.images += from.images;
  into.toolCalls += from.toolCalls;
  into.attachments += from.attachments;
  into.artefacts += from.artefacts;
  into.knowledgeLookups += from.knowledgeLookups;
}

/** Walk the parent chain from current_node to the root; reverse to root→leaf. */
function linearise(
  mapping: Record<string, unknown>,
  currentNodeId: unknown,
): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  let nodeId: unknown = currentNodeId;
  while (typeof nodeId === 'string' && nodeId !== '' && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!isRecord(node)) break;
    if (isRecord(node.message)) chain.push(node.message);
    nodeId = node.parent;
  }
  return chain.reverse();
}

/** String parts joined; non-string parts (image pointers etc.) count as images. */
function extractParts(parts: unknown): { text: string; droppedImages: number } {
  if (!Array.isArray(parts)) return { text: '', droppedImages: 0 };
  const texts: string[] = [];
  let droppedImages = 0;
  for (const p of parts) {
    if (typeof p === 'string') {
      if (p.trim() !== '') texts.push(p);
    } else {
      droppedImages++;
    }
  }
  return { text: texts.join('\n\n').trim(), droppedImages };
}

function syntheticContextText(content: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof content.user_profile === 'string' && content.user_profile.trim() !== '')
    parts.push(`[User Profile]\n${content.user_profile.trim()}`);
  if (typeof content.user_instructions === 'string' && content.user_instructions.trim() !== '')
    parts.push(`[Custom Instructions]\n${content.user_instructions.trim()}`);
  return parts.join('\n\n');
}

/** What a skipped message contributes to the dropped tally: its non-string
 *  parts count as images (multimodal), else the whole message counts once. */
function droppedForSkipped(role: string, contentType: string, parts: unknown): DroppedCounts {
  const d = zeroDropped();
  const { droppedImages } = extractParts(parts);
  if (droppedImages > 0) d.images = droppedImages;
  else if (contentType.includes('image')) d.images = 1;
  else if (role === 'tool') d.toolCalls = 1;
  else if (contentType !== 'text') d.attachments = 1;
  return d;
}

function parseConversation(
  raw: Record<string, unknown>,
): ThirdPartyConversation | FailedConversation {
  const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title : null;
  const id =
    typeof raw.conversation_id === 'string' && raw.conversation_id !== ''
      ? raw.conversation_id
      : typeof raw.id === 'string' && raw.id !== ''
        ? raw.id
        : null;
  if (id === null || !isRecord(raw.mapping)) {
    return { title, reason: 'Unreadable conversation structure' };
  }

  const createdAt = chatGptSecondsToMs(raw.create_time) ?? 0;
  const lastMessageAt = chatGptSecondsToMs(raw.update_time) ?? createdAt;
  const messages: ThirdPartyMessage[] = [];
  const pendingDropped = zeroDropped();

  for (const m of linearise(raw.mapping, raw.current_node)) {
    const author = isRecord(m.author) ? m.author : {};
    const role = typeof author.role === 'string' ? author.role : '';
    const content = isRecord(m.content) ? m.content : {};
    const contentType = typeof content.content_type === 'string' ? content.content_type : '';
    const meta = isRecord(m.metadata) ? m.metadata : {};
    const hidden = meta.is_visually_hidden_from_conversation === true;
    const statusOk = KEEPABLE_STATUS.has(m.status as string | null | undefined);

    if (contentType === 'user_editable_context') {
      const text = syntheticContextText(content);
      if (text !== '') {
        messages.push({
          role: 'user',
          createdAt: createdAt > 0 ? createdAt - 1000 : 0,
          blocks: [{ type: 'text', text }],
          dropped: zeroDropped(),
        });
      }
      continue;
    }

    const keepable = KEEPABLE_ROLES.has(role) && statusOk && contentType === 'text' && !hidden;
    if (!keepable) {
      // Hidden text messages vanish silently (chatsune behaviour); everything
      // else non-keepable feeds the dropped tally for the next kept message.
      if (!hidden) addDropped(pendingDropped, droppedForSkipped(role, contentType, content.parts));
      continue;
    }

    const { text, droppedImages } = extractParts(content.parts);
    pendingDropped.images += droppedImages;
    if (text === '') continue;

    const dropped = { ...pendingDropped };
    Object.assign(pendingDropped, zeroDropped());
    messages.push({
      role: role === 'assistant' ? 'persona' : 'user',
      createdAt: chatGptSecondsToMs(m.create_time) ?? 0,
      blocks: [{ type: 'text', text }],
      dropped,
    });
  }

  // Leftover dropped counts attach to the last kept message.
  const last = messages[messages.length - 1];
  if (last) addDropped(last.dropped, pendingDropped);

  return {
    sourceId: `chatgpt/${id}`,
    source: 'chatgpt',
    title,
    createdAt,
    lastMessageAt,
    messages,
  };
}

/** Parse a ChatGPT `conversations.json` payload (top-level array) — spec §5. */
export function parseChatGptExport(raw: unknown): ParseResult {
  if (!Array.isArray(raw)) throw new TypeError('not a ChatGPT export');
  const conversations: ThirdPartyConversation[] = [];
  const failures: FailedConversation[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      failures.push({ title: null, reason: 'Unreadable conversation structure' });
      continue;
    }
    const parsed = parseConversation(item);
    if ('sourceId' in parsed) conversations.push(parsed);
    else failures.push(parsed);
  }
  return { source: 'chatgpt', conversations, failures };
}
