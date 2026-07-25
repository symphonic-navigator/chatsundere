// SPDX-License-Identifier: AGPL-3.0-only
import { type ReasoningIntent, buildContentAxisPrompt } from '@chatsundere/llm-unified';
import { getClientDataDb } from '../../boot/client-data-db.js';
import { addGeneratedArtefact } from '../../data/artefacts.js';
import { QK } from '../../data/queryKeys.js';
import {
  type ArtefactCreateFormat,
  type AuthorArtefactArgs,
  authorArtefact,
} from '../../lib/artefact-author.js';
import {
  type CraftRunArgs,
  runCraftInspect,
  runCraftModify,
} from '../../lib/artefact-craft-runner.js';
import {
  artefactExpertUnavailableResult,
  resolveArtefactBase,
} from '../../lib/artefact-model-resolve.js';
import { queryClient } from '../../lib/queryClient.js';
import type { SubagentBase } from '../../lib/subagent-base.js';
import type { Tool, ToolResult } from '../../tools/types.js';
import type { Integration, IntegrationContext } from '../types.js';

export {
  artefactExpertUnavailableResult,
  resolveArtefactBase,
} from '../../lib/artefact-model-resolve.js';

const CREATE_INSTRUCTION =
  'A `create_artefact` tool produces a single self-contained document — either an HTML file ' +
  '(small web app or interactive view) or a Markdown document — that the user can open, edit, ' +
  'download, and reuse. Use it when the user wants a UI, demo, widget, interactive page, or a ' +
  'structured document — not for ordinary chat prose. Pass a COMPLETE, self-contained `brief`: ' +
  'a separate author writes the file from your brief alone, so include every requirement, all ' +
  'content, and the styling intent. Prefer `format: "html"` for interactive pages and ' +
  '`format: "markdown"` for notes/docs. HTML must be one file with no external resources. ' +
  'After it is created, simply tell the user it is ready.';

const LIST_INSTRUCTION =
  'A `list_artefacts` tool returns the text artefacts in this chat (titles, ids, formats, ' +
  'sizes — no bodies). Call it before `modify_artefact` or `inspect_artefact` so you pass ' +
  'real ids. Never invent artefact ids.';

const MODIFY_INSTRUCTION =
  'A `modify_artefact` tool edits an existing text artefact via a separate editor subagent. ' +
  'Pass the artefact `id` from `list_artefacts` and a COMPLETE `brief` with every change ' +
  'required — the editor sees only your brief and the file tools, not this conversation. ' +
  'List first when you are unsure of the id. After success, tell the user the document was updated.';

const INSPECT_INSTRUCTION =
  'An `inspect_artefact` tool answers a question about an existing text artefact via a ' +
  'separate analyst subagent that can read the file without loading the full source into ' +
  'this session. Pass the artefact `id` from `list_artefacts` and a clear `question`. ' +
  'Relay the analyst’s answer in your own voice.';

/** Injectable seams (real defaults below) so the tool is unit-testable. */
export interface ArtefactToolDeps {
  author?: (args: AuthorArtefactArgs) => Promise<string>;
  resolveBase?: (ctx: IntegrationContext) => { base: SubagentBase; reasoning: ReasoningIntent };
}

/** Injectable craft runner for modify/inspect persona tools. */
export interface CraftPersonaToolDeps {
  runModify?: (args: Omit<CraftRunArgs, 'mode'>) => Promise<ToolResult>;
  runInspect?: (args: Omit<CraftRunArgs, 'mode'>) => Promise<ToolResult>;
  resolveBase?: CraftRunArgs['resolveBase'];
}

/** Parse optional `format` tool arg; missing → html; invalid → constructive error string. */
function parseCreateFormat(raw: unknown): ArtefactCreateFormat | { error: string } {
  if (raw === undefined || raw === null || raw === '') return 'html';
  if (typeof raw !== 'string') {
    return {
      error: 'create_artefact format must be "html" or "markdown" (default html).',
    };
  }
  const normalised = raw.trim().toLowerCase();
  if (normalised === 'html' || normalised === 'markdown') return normalised;
  return {
    error: `create_artefact format must be "html" or "markdown" (got "${raw}").`,
  };
}

/** Build a `create_artefact` tool bound to the given integration context.
 *  Injectable `deps` allow unit tests to bypass the provider registry and
 *  network entirely. */
export function makeArtefactTool(ctx: IntegrationContext, deps: ArtefactToolDeps = {}): Tool {
  const author = deps.author ?? authorArtefact;
  const resolveBase = deps.resolveBase ?? resolveArtefactBase;
  return {
    name: 'create_artefact',
    description:
      'Create a single artefact the user can open, edit, download, and reuse — either a ' +
      'self-contained HTML page (interactive web app or view) or a Markdown document. ' +
      'Provide a title, a complete brief, and optionally format ("html" default, or "markdown").',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable title for the artefact.' },
        brief: {
          type: 'string',
          description:
            'A complete, self-contained description of the file to build: all requirements, content, and styling. A separate author writes the file from this alone.',
        },
        format: {
          type: 'string',
          description:
            'Output format: "html" (default) for interactive pages, or "markdown" for documents.',
          enum: ['html', 'markdown'],
        },
      },
      required: ['title', 'brief'],
    },
    systemPromptInstruction: CREATE_INSTRUCTION,
    async execute(args, signal, onProgress): Promise<ToolResult> {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
      if (title.length === 0 || brief.length === 0) {
        return { ok: false, output: '', error: 'create_artefact needs a title and a brief.' };
      }
      const formatOrErr = parseCreateFormat(args.format);
      if (typeof formatOrErr === 'object' && 'error' in formatOrErr) {
        return { ok: false, output: '', error: formatOrErr.error };
      }
      const format = formatOrErr;
      try {
        const usingExpert = ctx.artefactExpert != null;
        let resolved: { base: SubagentBase; reasoning: ReasoningIntent };
        try {
          resolved = resolveBase(ctx);
        } catch {
          if (usingExpert) return artefactExpertUnavailableResult(ctx);
          return { ok: false, output: '', error: 'Artefact author: model not resolvable.' };
        }
        const providerId = (ctx.artefactExpert ?? ctx.personaOffering).providerId;
        const key = await ctx.getKey(providerId);
        if (!key) {
          if (usingExpert) return artefactExpertUnavailableResult(ctx);
          return { ok: false, output: '', error: 'No API key for the artefact author model.' };
        }
        const base = { ...resolved.base, apiKey: key };
        const contentAxisPrompt = buildContentAxisPrompt({
          nsfwEnabled: ctx.nsfwAllowed,
          tonalityEnabled: ctx.tonalityEnabled,
          globalInstructions: ctx.globalInstructions,
        });
        const content = await author({
          base,
          brief,
          format,
          contentAxisPrompt,
          reasoning: resolved.reasoning,
          signal,
          onProgress: (n) => onProgress?.({ charCount: n }),
        });
        const id = await addGeneratedArtefact({
          chatId: ctx.chatId,
          personaId: ctx.personaId,
          title,
          content,
          format,
        });
        // The tool runs outside React, so the chat-page artefacts query (which
        // feeds the lightbox) won't see the new row on its own. Invalidate now —
        // otherwise tapping the pill can't open the artefact until another
        // observer refetches (e.g. the sidebar being opened once).
        void queryClient.invalidateQueries({ queryKey: QK.chatArtefacts(ctx.chatId) });
        return {
          ok: true,
          output: `Created artefact «${title}» (id: ${id}). It is ready — let the user know.`,
          error: null,
          meta: { artefactId: id, title, format },
        };
      } catch (e) {
        return {
          ok: false,
          output: '',
          error: e instanceof Error ? e.message : 'Artefact creation failed.',
        };
      }
    },
  };
}

/** Instant index of text artefacts in this chat (no subagent, no bodies). */
export function makeListArtefactsTool(ctx: IntegrationContext): Tool {
  return {
    name: 'list_artefacts',
    description:
      'List text artefacts in this chat (id, title, file name, format, size, timestamps). ' +
      'Use before modify_artefact or inspect_artefact so you pass real ids.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    systemPromptInstruction: LIST_INSTRUCTION,
    async execute(): Promise<ToolResult> {
      const rows = await getClientDataDb().artefacts.where('chatId').equals(ctx.chatId).toArray();
      const artefacts = rows
        .filter((r) => r.kind === 'text')
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
        .map((r) => ({
          id: r.id,
          title: r.title,
          fileName: r.fileName,
          format: r.format,
          origin: r.origin,
          charLength: r.content.length,
          updatedAt: r.updatedAt,
        }));
      return {
        ok: true,
        output: JSON.stringify({ artefacts, total: artefacts.length }),
        error: null,
      };
    },
  };
}

/** Edit an existing text artefact via the craft modify subagent. */
export function makeModifyArtefactTool(
  ctx: IntegrationContext,
  deps: CraftPersonaToolDeps = {},
): Tool {
  const runModify = deps.runModify ?? runCraftModify;
  return {
    name: 'modify_artefact',
    description:
      'Modify an existing text artefact (HTML or Markdown) in this chat. Pass artefactId from ' +
      'list_artefacts and a complete brief describing the desired changes.',
    parameters: {
      type: 'object',
      properties: {
        artefactId: {
          type: 'string',
          description: 'Id of the text artefact to edit (from list_artefacts).',
        },
        brief: {
          type: 'string',
          description:
            'Complete, self-contained edit brief: every change required. A separate editor applies it.',
        },
      },
      required: ['artefactId', 'brief'],
    },
    systemPromptInstruction: MODIFY_INSTRUCTION,
    async execute(args, signal, onProgress): Promise<ToolResult> {
      const artefactId = typeof args.artefactId === 'string' ? args.artefactId.trim() : '';
      const brief = typeof args.brief === 'string' ? args.brief : '';
      if (artefactId.length === 0) {
        return {
          ok: false,
          output: '',
          error: 'modify_artefact needs artefactId. Call list_artefacts first.',
        };
      }
      if (brief.trim().length === 0) {
        return { ok: false, output: '', error: 'modify_artefact needs a non-empty brief.' };
      }
      return runModify({
        ctx,
        artefactId,
        briefOrQuestion: brief,
        signal,
        onProgress,
        resolveBase: deps.resolveBase,
      });
    },
  };
}

/** Answer a question about an existing text artefact via the craft inspect subagent. */
export function makeInspectArtefactTool(
  ctx: IntegrationContext,
  deps: CraftPersonaToolDeps = {},
): Tool {
  const runInspect = deps.runInspect ?? runCraftInspect;
  return {
    name: 'inspect_artefact',
    description:
      'Inspect an existing text artefact and answer a question about its content without ' +
      'loading the full source into this chat session. Pass artefactId from list_artefacts.',
    parameters: {
      type: 'object',
      properties: {
        artefactId: {
          type: 'string',
          description: 'Id of the text artefact to inspect (from list_artefacts).',
        },
        question: {
          type: 'string',
          description: 'Clear question about the artefact content or structure.',
        },
      },
      required: ['artefactId', 'question'],
    },
    systemPromptInstruction: INSPECT_INSTRUCTION,
    async execute(args, signal, onProgress): Promise<ToolResult> {
      const artefactId = typeof args.artefactId === 'string' ? args.artefactId.trim() : '';
      const question = typeof args.question === 'string' ? args.question : '';
      if (artefactId.length === 0) {
        return {
          ok: false,
          output: '',
          error: 'inspect_artefact needs artefactId. Call list_artefacts first.',
        };
      }
      if (question.trim().length === 0) {
        return { ok: false, output: '', error: 'inspect_artefact needs a non-empty question.' };
      }
      return runInspect({
        ctx,
        artefactId,
        briefOrQuestion: question,
        signal,
        onProgress,
        resolveBase: deps.resolveBase,
      });
    },
  };
}

/** Always-on artefact integration: list / create / modify / inspect on every send.
 *  Tool-support gating (whether the persona's model supports function calling)
 *  is handled by the registry/stream-manager at dispatch time. */
export const artefactIntegration: Integration = {
  id: 'artefact',
  capability: 'llm',
  contributesTools(ctx: IntegrationContext): Tool[] {
    return [
      makeListArtefactsTool(ctx),
      makeArtefactTool(ctx),
      makeModifyArtefactTool(ctx),
      makeInspectArtefactTool(ctx),
    ];
  },
};
