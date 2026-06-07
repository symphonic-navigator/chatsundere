// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, ToolResult } from '../tools/types.js';
import type { LibraryMeta, RetrievedChunk } from './retrieval.js';

/** Per-send knowledge context: the searchable libraries and a retrieve closure. */
export interface KnowledgeContext {
  libraries: LibraryMeta[];
  retrieve: (query: string, signal?: AbortSignal) => Promise<RetrievedChunk[]>;
}

/** Format retrieved chunks for the model — one provenance-headed block each. */
export function formatRetrieval(hits: RetrievedChunk[]): string {
  if (hits.length === 0) return 'No relevant passages found in the assigned knowledge libraries.';
  return hits
    .map((h) => {
      const path = [h.libraryName, h.documentTitle, ...h.headingPath].join(' › ');
      return `[${path}]  (${h.score.toFixed(2)})\n${h.text}`;
    })
    .join('\n\n---\n\n');
}

/** Band-2 awareness text naming the available libraries, or '' when none. */
export function renderKnowledgeAwareness(libraries: LibraryMeta[]): string {
  if (libraries.length === 0) return '';
  const lines = libraries.map((l) =>
    l.description.trim() ? `- **${l.name}** — ${l.description.trim()}` : `- **${l.name}**`,
  );
  return [
    "You can search the user's knowledge libraries with `query_knowledgebase`. Available libraries:",
    ...lines,
    'Search them when a question may be covered there rather than answering from memory.',
  ].join('\n');
}

/** The context-tool family for the knowledgebase. Empty when no libraries. */
export function contributeKnowledgeTools(ctx: KnowledgeContext): Tool[] {
  if (ctx.libraries.length === 0) return [];
  return [
    {
      name: 'query_knowledgebase',
      description:
        "Search the user's assigned knowledge libraries for relevant passages. Use it when a question may be covered by the libraries listed in your context rather than answering from memory.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to look up.' } },
        required: ['query'],
      },
      systemPromptInstruction:
        'When a question may be answered from the user knowledge libraries, call query_knowledgebase before answering from memory.',
      async execute(args, signal): Promise<ToolResult> {
        try {
          const query = typeof args.query === 'string' ? args.query : '';
          const hits = await ctx.retrieve(query, signal);
          return { ok: true, output: formatRetrieval(hits), error: null };
        } catch (e) {
          return {
            ok: false,
            output: '',
            error: e instanceof Error ? e.message : 'Knowledge search failed.',
          };
        }
      },
    },
  ];
}
