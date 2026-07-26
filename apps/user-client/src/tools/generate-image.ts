// SPDX-License-Identifier: AGPL-3.0-only
import {
  type GenerateImagesResult,
  type ImageModelConfig,
  maxCountFor,
} from '@chatsundere/llm-unified';
import type { Tool, ToolResult } from './types.js';

/** One configured image-model slot, fully resolved by the send path. */
export interface ImageGenerationSlot {
  /** "providerTemplateId:upstreamSlug" — provenance for genMeta. */
  ref: string;
  modelLabel: string;
  canDoNsfw: boolean;
  config: ImageModelConfig;
}

/** Per-send image-generation context. Closures keep the tool free of db/network imports. */
export interface ImageToolContext {
  chatId: string;
  personaId: string;
  primary: ImageGenerationSlot | null;
  nsfwSlot: ImageGenerationSlot | null;
  /** The spec gate, precomputed by the send path via computeNsfwParamAllowed. */
  nsfwParamAllowed: boolean;
  generate: (
    slot: ImageGenerationSlot,
    prompt: string,
    count: number,
    signal?: AbortSignal,
  ) => Promise<GenerateImagesResult>;
  /** Persists one image as an artefact (thumbnail + Dexie row); returns its id. */
  persistImage: (
    item: { bytes: Blob; mime: string },
    meta: { prompt: string; slot: ImageGenerationSlot },
  ) => Promise<string>;
}

/** The nsfw parameter exists only when all three conditions hold (spec §2.6). */
export function computeNsfwParamAllowed(
  adultPersona: boolean,
  adultMode: 'nsfw' | 'sfw',
  nsfwCapableModelConfigured: boolean,
): boolean {
  return adultPersona && adultMode === 'nsfw' && nsfwCapableModelConfigured;
}

const NOT_CONFIGURED =
  'No image model is configured yet. Tell the user that image generation is available once they pick a model in My Settings → Image generation.';
const NSFW_UNAVAILABLE =
  'NSFW image generation is not available — no NSFW-capable model is configured. Offer the user a non-explicit variant of their idea instead.';

function clampCount(raw: unknown, config: ImageModelConfig): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 1;
  return Math.min(Math.max(1, n), maxCountFor(config));
}

/** The generate_image context tool — always exactly one tool (always-offered design). */
export function contributeImageTool(ctx: ImageToolContext): Tool[] {
  const properties: Record<string, unknown> = {
    prompt: {
      type: 'string',
      description: 'A detailed description of the image(s): subject, style, lighting, composition.',
    },
    count: {
      type: 'integer',
      minimum: 1,
      description:
        'How many variants to generate. Omit for the normal case of one image; only set when the user explicitly asks for multiple variants (e.g. "show me three options" → count: 3).',
    },
  };
  if (ctx.nsfwParamAllowed) {
    properties.nsfw = {
      type: 'boolean',
      description:
        'Set true only when the user asks for explicit adult imagery. Routes to the NSFW-capable model.',
    };
  }
  return [
    {
      name: 'generate_image',
      description:
        'Generate one or more images from a text prompt. The user has pre-configured the model and image dimensions; you only choose the prompt. Be descriptive — a good prompt has subject, style, lighting, and composition cues.',
      parameters: { type: 'object', properties, required: ['prompt'] },
      systemPromptInstruction: null,
      async execute(args, signal): Promise<ToolResult> {
        if (ctx.primary === null) return { ok: false, output: '', error: NOT_CONFIGURED };
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        if (prompt.length === 0) {
          return {
            ok: false,
            output: '',
            error: 'The prompt was empty — write a detailed description and call the tool again.',
          };
        }
        const wantNsfw = args.nsfw === true;
        const slot = wantNsfw
          ? (ctx.nsfwSlot ?? (ctx.primary.canDoNsfw ? ctx.primary : null))
          : ctx.primary;
        if (slot === null) return { ok: false, output: '', error: NSFW_UNAVAILABLE };

        const count = clampCount(args.count, slot.config);
        let result: GenerateImagesResult;
        try {
          result = await ctx.generate(slot, prompt, count, signal);
        } catch (e) {
          const err = e as { providerMessage?: string; message?: string };
          const detail = err.providerMessage ?? err.message ?? 'unknown error';
          return {
            ok: false,
            output: '',
            error: `Image generation failed (${detail}). Tell the user, and suggest rephrasing the prompt or simply asking again.`,
          };
        }

        const artefactIds: string[] = [];
        const moderatedReasons: string[] = [];
        const failedReasons: string[] = [];
        for (const item of result.items) {
          if (item.kind === 'moderated') {
            moderatedReasons.push(item.reason ?? 'no reason given');
            continue;
          }
          // Distinct from moderation: the provider drew the image, we could not
          // collect it. Blaming the prompt here would be a lie and would send
          // the user rewriting something that was never the problem.
          if (item.kind === 'failed') {
            failedReasons.push(item.reason);
            continue;
          }
          artefactIds.push(
            await ctx.persistImage({ bytes: item.bytes, mime: item.mime }, { prompt, slot }),
          );
        }

        if (artefactIds.length === 0) {
          // Two different failures, two different next steps for the user. Only
          // a moderation refusal is about the prompt; a collection failure is
          // ours, and telling them to rephrase would send them chasing a fault
          // they cannot fix.
          if (moderatedReasons.length === 0) {
            return {
              ok: false,
              output: '',
              error: `The image was generated but could not be downloaded (${failedReasons.join('; ')}). Tell the user this is a connection problem on our side, not their prompt, and that trying again usually works.`,
            };
          }
          const failedNote =
            failedReasons.length > 0
              ? ` A further ${failedReasons.length} could not be downloaded (${failedReasons.join('; ')}) — a connection problem, not the prompt.`
              : '';
          return {
            ok: false,
            output: '',
            error: `Every image was blocked by the provider's content filter (${moderatedReasons.join('; ')}). Tell the user and suggest rephrasing the prompt.${failedNote}`,
          };
        }

        const lines = [
          `Generated ${artefactIds.length} image(s) from your prompt. They are already displayed to the user — refer to them in prose; do not output URLs, file paths, or markdown images.`,
        ];
        if (moderatedReasons.length > 0) {
          lines.push(
            `${moderatedReasons.length} image was blocked by the provider's content filter (reason: ${moderatedReasons.join('; ')}).`,
          );
        }
        if (failedReasons.length > 0) {
          lines.push(
            `${failedReasons.length} image could not be downloaded (${failedReasons.join('; ')}) — a connection problem on our side, not the prompt.`,
          );
        }
        return {
          ok: true,
          output: lines.join(' '),
          error: null,
          meta: {
            artefactIds,
            prompt,
            modelLabel: slot.modelLabel,
            moderatedReasons,
          },
        };
      },
    },
  ];
}
