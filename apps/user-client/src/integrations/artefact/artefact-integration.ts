// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ReasoningIntent,
  getOffering,
  getProvider,
  offeringToTarget,
} from '@chatsundere/llm-unified';
import { addGeneratedArtefact } from '../../data/artefacts.js';
import { QK } from '../../data/queryKeys.js';
import {
  type AuthorArtefactArgs,
  type AuthorBase,
  authorArtefact,
} from '../../lib/artefact-author.js';
import { queryClient } from '../../lib/queryClient.js';
import { initialReasoningState, resolveReasoningBodyExtras } from '../../lib/reasoning-resolver.js';
import type { SubagentBase } from '../../lib/subagent-base.js';
import type { Tool, ToolResult } from '../../tools/types.js';
import type { Integration, IntegrationContext } from '../types.js';

const INSTRUCTION =
  'A `create_artefact` tool produces a single self-contained HTML file (a small web app or ' +
  'interactive view) that the user can open, edit, download, and reuse. Use it when the user ' +
  'wants a UI, demo, widget, or interactive page — not for ordinary prose. Pass a COMPLETE, ' +
  'self-contained `brief`: a separate author writes the file from your brief alone, so include ' +
  'every requirement, all content, and the styling intent. The file must be one file with no ' +
  'external resources. After it is created, simply tell the user it is ready.';

/** Injectable seams (real defaults below) so the tool is unit-testable. */
export interface ArtefactToolDeps {
  author?: (args: AuthorArtefactArgs) => Promise<string>;
  resolveBase?: (ctx: IntegrationContext) => { base: SubagentBase; reasoning: ReasoningIntent };
}

function defaultResolveBase(ctx: IntegrationContext): {
  base: SubagentBase;
  reasoning: ReasoningIntent;
} {
  const providerDef = getProvider(ctx.personaOffering.providerId);
  const offering = getOffering(ctx.personaOffering.providerId, ctx.personaOffering.upstreamSlug);
  if (!providerDef || !offering) throw new Error('Artefact author: persona model not resolvable');
  const control = offering.profile.reasoning;
  const reasoning = (resolveReasoningBodyExtras(control, initialReasoningState(control))
    .reasoning as ReasoningIntent | undefined) ?? { enabled: false };
  return {
    base: {
      provider: providerDef,
      providerConfig: {
        baseUrl: providerDef.baseUrl,
        routing:
          providerDef.corsHint === 'requires-proxy' ? { kind: 'cors-proxy' } : { kind: 'direct' },
      },
      apiKey: '', // filled by execute (async key fetch)
      target: offeringToTarget(offering),
    },
    reasoning,
  };
}

/** Build a `create_artefact` tool bound to the given integration context.
 *  Injectable `deps` allow unit tests to bypass the provider registry and
 *  network entirely. */
export function makeArtefactTool(ctx: IntegrationContext, deps: ArtefactToolDeps = {}): Tool {
  const author = deps.author ?? authorArtefact;
  const resolveBase = deps.resolveBase ?? defaultResolveBase;
  return {
    name: 'create_artefact',
    description:
      'Create a single self-contained HTML artefact (a small interactive web app or view) the user can open, edit, download, and reuse. Provide a title and a complete brief.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable title for the artefact.' },
        brief: {
          type: 'string',
          description:
            'A complete, self-contained description of the file to build: all requirements, content, and styling. A separate author writes the file from this alone.',
        },
      },
      required: ['title', 'brief'],
    },
    systemPromptInstruction: INSTRUCTION,
    async execute(args, signal, onProgress): Promise<ToolResult> {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
      if (title.length === 0 || brief.length === 0) {
        return { ok: false, output: '', error: 'create_artefact needs a title and a brief.' };
      }
      try {
        const key = await ctx.getKey(ctx.personaOffering.providerId);
        if (!key)
          return { ok: false, output: '', error: 'No API key for the artefact author model.' };
        const resolved = resolveBase(ctx);
        const base = { ...resolved.base, apiKey: key };
        const content = await author({
          base,
          brief,
          reasoning: resolved.reasoning,
          signal,
          onProgress: (n) => onProgress?.({ charCount: n }),
        });
        const id = await addGeneratedArtefact({
          chatId: ctx.chatId,
          personaId: ctx.personaId,
          title,
          content,
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
          meta: { artefactId: id, title, format: 'html' },
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

/** Always-on artefact integration: contributes `create_artefact` on every send.
 *  Tool-support gating (whether the persona's model supports function calling)
 *  is handled by the registry/stream-manager at dispatch time. */
export const artefactIntegration: Integration = {
  id: 'artefact',
  capability: 'llm',
  contributesTools(ctx: IntegrationContext): Tool[] {
    return [makeArtefactTool(ctx)];
  },
};
