// SPDX-License-Identifier: AGPL-3.0-only

import type { DroppedCounts } from '../chatsune-import/dropped-hint.js';

export type ThirdPartySource = 'chatgpt' | 'grok';

export interface ThirdPartyBlock {
  type: 'text' | 'reasoning';
  text: string;
}

export interface ThirdPartyMessage {
  role: 'user' | 'persona';
  /** Epoch ms; 0 when the source carried no usable timestamp (writer synthesises order). */
  createdAt: number;
  blocks: ThirdPartyBlock[];
  /** What this message lost on import; all-zero when nothing was dropped. */
  dropped: DroppedCounts;
}

export interface ThirdPartyConversation {
  /** Namespaced dedup key: "chatgpt/<id>" | "grok/<id>" (spec §7). */
  sourceId: string;
  source: ThirdPartySource;
  title: string | null;
  createdAt: number;
  lastMessageAt: number;
  /** Linear (flattened) order; empty ⇒ "Nothing importable" in the UI. */
  messages: ThirdPartyMessage[];
}

/** A conversation the parser could not process; listed disabled in the UI (spec §9). */
export interface FailedConversation {
  title: string | null;
  reason: string;
}

export interface ParseResult {
  source: ThirdPartySource;
  conversations: ThirdPartyConversation[];
  failures: FailedConversation[];
}

/** Runtime type guard shared by both parsers. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A fresh all-zero DroppedCounts. */
export function zeroDropped(): DroppedCounts {
  return { images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 };
}
