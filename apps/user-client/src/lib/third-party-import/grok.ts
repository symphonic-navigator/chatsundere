// SPDX-License-Identifier: AGPL-3.0-only

import { parseGrokTimestamp } from './time.js';
import {
  type FailedConversation,
  type ParseResult,
  type ThirdPartyBlock,
  type ThirdPartyConversation,
  type ThirdPartyMessage,
  isRecord,
  zeroDropped,
} from './types.js';

interface GrokNode {
  id: string;
  parent: string | null;
  raw: Record<string, unknown>;
  createdAt: number;
}

function collectNodes(responses: unknown): GrokNode[] {
  if (!Array.isArray(responses)) return [];
  const nodes: GrokNode[] = [];
  for (const envelope of responses) {
    if (!isRecord(envelope) || !isRecord(envelope.response)) continue;
    const r = envelope.response;
    if (r.partial === true) continue;
    if (typeof r._id !== 'string' || r._id === '') continue;
    nodes.push({
      id: r._id,
      parent: typeof r.parent_response_id === 'string' ? r.parent_response_id : null,
      raw: r,
      createdAt: parseGrokTimestamp(r.create_time) ?? 0,
    });
  }
  return nodes;
}

/** Newest-branch flatten: chain from the newest response up to the root. */
function lineariseNewestBranch(nodes: GrokNode[]): GrokNode[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let newest = nodes[0];
  for (const n of nodes) {
    if (newest === undefined || n.createdAt >= newest.createdAt) newest = n;
  }
  const chain: GrokNode[] = [];
  const visited = new Set<string>();
  let cursor: GrokNode | undefined = newest;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parent !== null ? byId.get(cursor.parent) : undefined;
  }
  return chain.reverse();
}

function reasoningText(r: Record<string, unknown>): string {
  if (typeof r.thinking_trace === 'string' && r.thinking_trace.trim() !== '')
    return r.thinking_trace.trim();
  if (Array.isArray(r.agent_thinking_traces)) {
    const parts = r.agent_thinking_traces
      .map((t) =>
        isRecord(t) && typeof t.thinking_trace === 'string' ? t.thinking_trace.trim() : '',
      )
      .filter((t) => t !== '');
    return parts.join('\n\n');
  }
  return '';
}

function toMessage(node: GrokNode): ThirdPartyMessage | null {
  const r = node.raw;
  const blocks: ThirdPartyBlock[] = [];
  const reasoning = reasoningText(r);
  if (reasoning !== '') blocks.push({ type: 'reasoning', text: reasoning });
  const text = typeof r.message === 'string' ? r.message.trim() : '';
  if (text !== '') blocks.push({ type: 'text', text });
  if (blocks.length === 0) return null;

  const dropped = zeroDropped();
  if (Array.isArray(r.file_attachments)) dropped.attachments = r.file_attachments.length;
  if (Array.isArray(r.generated_image_urls)) dropped.images = r.generated_image_urls.length;

  const sender = typeof r.sender === 'string' ? r.sender.toLowerCase() : '';
  return {
    role: sender === 'human' ? 'user' : 'persona',
    createdAt: node.createdAt,
    blocks,
    dropped,
  };
}

function parseConversation(
  item: Record<string, unknown>,
): ThirdPartyConversation | FailedConversation {
  const meta = isRecord(item.conversation) ? item.conversation : {};
  const title = typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : null;
  const id = typeof meta.id === 'string' && meta.id !== '' ? meta.id : null;
  if (id === null) return { title, reason: 'Unreadable conversation structure' };

  const createdAt = parseGrokTimestamp(meta.create_time) ?? 0;
  const lastMessageAt = parseGrokTimestamp(meta.modify_time) ?? createdAt;
  const messages: ThirdPartyMessage[] = [];
  for (const node of lineariseNewestBranch(collectNodes(item.responses))) {
    const m = toMessage(node);
    if (m) messages.push(m);
  }
  return { sourceId: `grok/${id}`, source: 'grok', title, createdAt, lastMessageAt, messages };
}

/** Parse a Grok export payload (object with a conversations array) — spec §6. */
export function parseGrokExport(raw: unknown): ParseResult {
  if (!isRecord(raw) || !Array.isArray(raw.conversations)) throw new TypeError('not a Grok export');
  const conversations: ThirdPartyConversation[] = [];
  const failures: FailedConversation[] = [];
  for (const item of raw.conversations) {
    if (!isRecord(item)) {
      failures.push({ title: null, reason: 'Unreadable conversation structure' });
      continue;
    }
    const parsed = parseConversation(item);
    if ('sourceId' in parsed) conversations.push(parsed);
    else failures.push(parsed);
  }
  return { source: 'grok', conversations, failures };
}
