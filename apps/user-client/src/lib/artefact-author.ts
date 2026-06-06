// SPDX-License-Identifier: AGPL-3.0-only
import {
  type CompletionTarget,
  type ProviderConfig,
  type ProviderDefinition,
  type StreamChunk,
  type WireMessage,
  streamCompletion,
} from '@chatsundere/llm-unified';

export const AUTHOR_SYSTEM_PROMPT =
  'You are a single-file web-app author. Output EXACTLY ONE self-contained HTML file and ' +
  'nothing else — no prose, no explanation, no surrounding Markdown commentary. Inline all ' +
  'CSS and JavaScript. Use NO external resources whatsoever: no CDN, no <script src>, no ' +
  '<link href> to remote stylesheets or fonts, no fetch/XHR/WebSocket, no imports. The file ' +
  'must run offline from a single document. Design mobile-first — it must work well at 380px ' +
  'wide. If you wrap the file in a code fence, use ```html.';

/** Strip a single leading ```html / ``` fence and a trailing ``` if present. */
export function stripFences(text: string): string {
  let t = text.trim();
  const open = t.match(/^```[a-zA-Z]*\s*\n/);
  if (open) t = t.slice(open[0].length);
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
}

export interface AuthorBase {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  target: CompletionTarget;
}

export interface AuthorArtefactArgs {
  base: AuthorBase;
  brief: string;
  signal?: AbortSignal;
  /** Live running character count of the file so far. */
  onProgress?: (charCount: number) => void;
  /** Injected for tests; defaults to the real streaming primitive. */
  streamFn?: typeof streamCompletion;
}

/** Run the author subagent: brief in, single self-contained HTML file out. */
export async function authorArtefact(args: AuthorArtefactArgs): Promise<string> {
  const stream = args.streamFn ?? streamCompletion;
  const messages: WireMessage[] = [
    { role: 'system', content: AUTHOR_SYSTEM_PROMPT },
    { role: 'user', content: args.brief },
  ];
  let acc = '';
  for await (const chunk of stream({
    provider: args.base.provider,
    providerConfig: args.base.providerConfig,
    apiKey: args.base.apiKey,
    corsProxyUrl: args.base.corsProxyUrl,
    corsProxyKey: args.base.corsProxyKey,
    target: args.base.target,
    messages,
    // No reasoning (we want the file, not a trace), no tools, generous output.
    bodyExtras: { temperature: 0.4, max_tokens: 8192, reasoning: { enabled: false } },
    signal: args.signal,
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
