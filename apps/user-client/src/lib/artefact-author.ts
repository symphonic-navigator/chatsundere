// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ReasoningIntent,
  type StreamChunk,
  type WireMessage,
  streamCompletion,
} from '@chatsundere/llm-unified';
import { SUBAGENT_INITIAL_RESPONSE_TIMEOUT_MS, type SubagentBase } from './subagent-base.js';

/** Output formats supported by `create_artefact` / the author subagent. */
export type ArtefactCreateFormat = 'html' | 'markdown';

export const AUTHOR_SYSTEM_PROMPT =
  'You are a single-file web-app author. Output EXACTLY ONE self-contained HTML file and ' +
  'nothing else — no prose, no explanation, no surrounding Markdown commentary. Inline all ' +
  'CSS and JavaScript. Use NO external resources whatsoever: no CDN, no <script src>, no ' +
  '<link href> to remote stylesheets or fonts, no fetch/XHR/WebSocket, no imports. The file ' +
  'must run offline from a single document. Design mobile-first — it must work well at 380px ' +
  'wide. If you wrap the file in a code fence, use ```html.';

const MARKDOWN_AUTHOR_SYSTEM_PROMPT =
  'You are a document author. Output EXACTLY ONE Markdown document and nothing else — no ' +
  'prose outside the document, no surrounding commentary. Use clear headings and structure. ' +
  'Do not wrap the whole document in an HTML shell unless the brief explicitly asks for ' +
  'embedded HTML snippets inside Markdown. If you wrap in a fence, use ```markdown or ```md.';

/** Craft-only system rules for the author subagent (no persona / roleplay). */
export function authorCraftRules(format: ArtefactCreateFormat): string {
  return format === 'markdown' ? MARKDOWN_AUTHOR_SYSTEM_PROMPT : AUTHOR_SYSTEM_PROMPT;
}

/** Strip a single leading ```html / ``` fence and a trailing ``` if present. */
export function stripFences(text: string): string {
  let t = text.trim();
  const open = t.match(/^```[a-zA-Z]*\s*\n/);
  if (open) t = t.slice(open[0].length);
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
}

/** @deprecated alias — use SubagentBase. Kept so existing imports resolve. */
export type AuthorBase = SubagentBase;

export interface AuthorArtefactArgs {
  base: AuthorBase;
  brief: string;
  /** Output format — craft rules differ for html vs markdown. */
  format: ArtefactCreateFormat;
  /** Pre-built content-axis unlocker text (may be empty). Appended after craft rules. */
  contentAxisPrompt: string;
  /** The author model's reasoning intent (its chat-default, resolved by the caller). */
  reasoning: ReasoningIntent;
  signal?: AbortSignal;
  /** Live running character count of the file so far. */
  onProgress?: (charCount: number) => void;
  /** Injected for tests; defaults to the real streaming primitive. */
  streamFn?: typeof streamCompletion;
}

/** Run the author subagent: brief in, single self-contained document out. */
export async function authorArtefact(args: AuthorArtefactArgs): Promise<string> {
  const stream = args.streamFn ?? streamCompletion;
  const rules = authorCraftRules(args.format);
  const axis = args.contentAxisPrompt.trim();
  const system = axis.length > 0 ? `${rules}\n\n${axis}` : rules;
  const messages: WireMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: args.brief },
  ];
  // When reasoning is on, double the token budget so reasoning tokens don't
  // crowd out the actual document output.
  const reasoningEnabled = args.reasoning.enabled === true;
  let acc = '';
  for await (const chunk of stream({
    provider: args.base.provider,
    providerConfig: args.base.providerConfig,
    apiKey: args.base.apiKey,
    target: args.base.target,
    messages,
    bodyExtras: {
      temperature: 0.4,
      max_tokens: reasoningEnabled ? 16384 : 8192,
      reasoning: args.reasoning,
    },
    signal: args.signal,
    initialResponseTimeoutMs: SUBAGENT_INITIAL_RESPONSE_TIMEOUT_MS,
  } as Parameters<typeof streamCompletion>[0])) {
    const c = chunk as StreamChunk;
    if (c.type === 'token') {
      acc += c.text;
      args.onProgress?.(acc.length);
    } else if (c.type === 'error') {
      throw new Error(c.message);
    }
  }
  const file = stripFences(acc);
  if (file.length === 0) throw new Error('Author produced empty output');
  return file;
}
