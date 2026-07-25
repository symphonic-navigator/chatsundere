// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ReasoningIntent,
  type StreamChunk,
  type ToolDef,
  type WireMessage,
  buildContentAxisPrompt,
  streamCompletion,
} from '@chatsundere/llm-unified';
import { getClientDataDb } from '../boot/client-data-db.js';
import { QK } from '../data/queryKeys.js';
import type { IntegrationContext } from '../integrations/types.js';
import { dispatch, toolDefs } from '../tools/tool-defs.js';
import type { ToolProgress, ToolResult } from '../tools/types.js';
import {
  type AgentLoopDeps,
  type AgentLoopResult,
  type AgentLoopStreamResult,
  runAgentLoop,
} from './agent-loop.js';
import { makeCraftTools } from './artefact-craft-tools.js';
import { artefactExpertUnavailableResult, resolveArtefactBase } from './artefact-model-resolve.js';
import { queryClient } from './queryClient.js';
import { SUBAGENT_INITIAL_RESPONSE_TIMEOUT_MS, type SubagentBase } from './subagent-base.js';

export type CraftMode = 'modify' | 'inspect';

export type CraftCompleteStatus = 'complete' | 'partial' | 'no-change';

/** Injectable seams for unit tests; production uses real streaming + agent loop. */
export interface CraftRunArgs {
  ctx: IntegrationContext;
  artefactId: string;
  /** Modify brief or inspect question. */
  briefOrQuestion: string;
  mode: CraftMode;
  signal?: AbortSignal;
  onProgress?: (p: ToolProgress) => void;
  resolveBase?: (ctx: IntegrationContext) => {
    base: SubagentBase;
    reasoning: ReasoningIntent;
  };
  streamFn?: typeof streamCompletion;
  runLoop?: typeof runAgentLoop;
  /** Test seam for tool set construction (e.g. spy allowWrite). */
  makeTools?: typeof makeCraftTools;
}

const MODIFY_MAX_ROUNDS = 6;
const INSPECT_MAX_ROUNDS = 4;

const MODIFY_TOOLS_USAGE =
  'You edit exactly one bound artefact via tools. Always call read_current_artefact ' +
  'before replace_current_artefact so you have a fresh expectedUpdatedAt. Prefer a single ' +
  'primary replace of the whole body when the brief is satisfied. Do not invent ids. ' +
  'You may list_artefacts or read_other_artefact for inspiration, but never claim to have ' +
  'changed another artefact. After tools, report honestly what you did (complete, partial, ' +
  'or no change) in short prose for the companion persona — not a dump of the full file.';

const INSPECT_TOOLS_USAGE =
  'You analyse one bound artefact via tools. Use read_current_artefact (and list / ' +
  'read_other only if needed). You have no write tools — never attempt to change the file. ' +
  'Answer the question in clear prose the companion can relay. Prefer explanation over ' +
  'dumping the entire source; short cited excerpts are fine when truly required.';

function editorCraftRules(format: string): string {
  if (format === 'markdown') {
    return (
      'You are an artefact editor for a Markdown document. Preserve structure, headings, ' +
      'and tone unless the brief asks otherwise. Whole-body replace only — output a full ' +
      'valid Markdown document as the new body. Do not wrap the body in an HTML shell ' +
      'unless the brief explicitly requires embedded HTML snippets.'
    );
  }
  return (
    'You are an artefact editor for a self-contained HTML file. Preserve behaviour and ' +
    'structure unless the brief asks otherwise. Whole-body replace only — the new body ' +
    'must remain one offline-capable HTML document with no external resources (no CDN, ' +
    'no remote scripts/fonts, no fetch to third parties). Honour mobile-first layout at 380px.'
  );
}

function analystCraftRules(format: string): string {
  if (format === 'markdown') {
    return (
      'You are an artefact analyst for a Markdown document. Infer structure from headings ' +
      'and sections; answer questions about content, organisation, and gaps.'
    );
  }
  return (
    'You are an artefact analyst for an HTML artefact (often a small interactive page). ' +
    'Reason about structure, UI behaviour, and content from the source without rewriting it.'
  );
}

function mapToolPhase(toolName: string, mode: CraftMode): ToolProgress['phase'] {
  if (toolName === 'replace_current_artefact') return 'writing';
  if (
    toolName === 'read_current_artefact' ||
    toolName === 'read_other_artefact' ||
    toolName === 'list_artefacts'
  ) {
    return 'reading';
  }
  return mode === 'inspect' ? 'explaining' : 'building';
}

function completeFromLedger(result: AgentLoopResult): CraftCompleteStatus {
  const hasSuccessReplace = result.ledger.some(
    (e) => (e.op === 'replace_current' || e.op === 'replace_current_artefact') && e.success,
  );
  if (hasSuccessReplace) {
    return result.roundLimitReached ? 'partial' : 'complete';
  }
  const hasReplaceAttempt = result.ledger.some(
    (e) => e.op === 'replace_current' || e.op === 'replace_current_artefact',
  );
  if (hasReplaceAttempt || result.roundLimitReached) return 'partial';
  return 'no-change';
}

function lastSuccessfulReplaceMeta(result: AgentLoopResult): {
  updatedAt?: number;
  targetId?: string;
} {
  for (let i = result.ledger.length - 1; i >= 0; i--) {
    const e = result.ledger[i];
    if (!e) continue;
    if (
      (e.op === 'replace_current' || e.op === 'replace_current_artefact') &&
      e.success &&
      typeof e.resultingUpdatedAt === 'number'
    ) {
      return { updatedAt: e.resultingUpdatedAt, targetId: e.targetId };
    }
  }
  return {};
}

/**
 * Stream one model pass for the craft subagent: system + user seed + exchange,
 * optional tools; accumulate tokens and complete tool-call chunks.
 */
export async function craftStreamOnce(opts: {
  base: SubagentBase;
  system: string;
  user: string;
  exchange: WireMessage[];
  tools: ToolDef[];
  reasoning: ReasoningIntent;
  signal?: AbortSignal;
  streamFn?: typeof streamCompletion;
  onToken?: (charCount: number) => void;
}): Promise<AgentLoopStreamResult> {
  const stream = opts.streamFn ?? streamCompletion;
  const messages: WireMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
    ...opts.exchange,
  ];
  const reasoningEnabled = opts.reasoning.enabled === true;
  let text = '';
  const toolCalls: AgentLoopStreamResult['toolCalls'] = [];

  for await (const chunk of stream({
    provider: opts.base.provider,
    providerConfig: opts.base.providerConfig,
    apiKey: opts.base.apiKey,
    target: opts.base.target,
    messages,
    bodyExtras: {
      temperature: 0.4,
      max_tokens: reasoningEnabled ? 16384 : 8192,
      reasoning: opts.reasoning,
    },
    tools: opts.tools.length > 0 ? opts.tools : undefined,
    signal: opts.signal,
    initialResponseTimeoutMs: SUBAGENT_INITIAL_RESPONSE_TIMEOUT_MS,
  } as Parameters<typeof streamCompletion>[0])) {
    const c = chunk as StreamChunk;
    if (c.type === 'token') {
      text += c.text;
      opts.onToken?.(text.length);
    } else if (c.type === 'tool-call') {
      toolCalls.push({
        id: c.toolCallId,
        name: c.name,
        argumentsJson: c.argumentsJson,
      });
    } else if (c.type === 'error') {
      throw new Error(c.message);
    }
  }

  return { text, toolCalls };
}

/**
 * Headless craft run for modify or inspect. Loads the bound text artefact,
 * resolves the artefact-expert (or persona) model, runs the agent loop with
 * craft tools, and returns a ToolResult for the persona tool layer.
 */
export async function runCraft(args: CraftRunArgs): Promise<ToolResult> {
  const { ctx, artefactId, briefOrQuestion, mode, signal, onProgress } = args;
  const resolveBase = args.resolveBase ?? resolveArtefactBase;
  const runLoop = args.runLoop ?? runAgentLoop;
  const makeTools = args.makeTools ?? makeCraftTools;

  const brief = briefOrQuestion.trim();
  if (brief.length === 0) {
    return {
      ok: false,
      output: '',
      error:
        mode === 'modify'
          ? 'modify_artefact needs a non-empty brief.'
          : 'inspect_artefact needs a non-empty question.',
    };
  }

  onProgress?.({ charCount: 0, phase: 'starting' });

  const row = await getClientDataDb().artefacts.get(artefactId);
  if (!row) {
    return {
      ok: false,
      output: '',
      error: `Artefact ${artefactId} was not found. Call list_artefacts and pass a real id.`,
    };
  }
  if (row.chatId !== ctx.chatId) {
    return {
      ok: false,
      output: '',
      error: 'That artefact is not in this chat. Call list_artefacts for ids in the current chat.',
    };
  }
  if (row.kind !== 'text') {
    return {
      ok: false,
      output: '',
      error: 'Only text artefacts (HTML or Markdown) can be modified or inspected this way.',
    };
  }

  const usingExpert = ctx.artefactExpert != null;
  let resolved: { base: SubagentBase; reasoning: ReasoningIntent };
  try {
    resolved = resolveBase(ctx);
  } catch {
    if (usingExpert) return artefactExpertUnavailableResult(ctx);
    return { ok: false, output: '', error: 'Artefact craft: model not resolvable.' };
  }

  const providerId = (ctx.artefactExpert ?? ctx.personaOffering).providerId;
  const key = await ctx.getKey(providerId);
  if (!key) {
    if (usingExpert) return artefactExpertUnavailableResult(ctx);
    return { ok: false, output: '', error: 'No API key for the artefact craft model.' };
  }
  const base = { ...resolved.base, apiKey: key };

  const contentAxisPrompt = buildContentAxisPrompt({
    nsfwEnabled: ctx.nsfwAllowed,
    tonalityEnabled: ctx.tonalityEnabled,
    globalInstructions: ctx.globalInstructions,
  });

  const format = row.format;
  const craftRules = mode === 'modify' ? editorCraftRules(format) : analystCraftRules(format);
  const toolsUsage = mode === 'modify' ? MODIFY_TOOLS_USAGE : INSPECT_TOOLS_USAGE;
  const axis = contentAxisPrompt.trim();
  const system =
    axis.length > 0
      ? `${craftRules}\n\n${toolsUsage}\n\n${axis}`
      : `${craftRules}\n\n${toolsUsage}`;

  const user =
    `${brief}\n\n` +
    `Current artefact: id=${row.id} title=${JSON.stringify(row.title)} ` +
    `format=${row.format} updatedAt=${row.updatedAt} charLength=${row.content.length}`;

  const allowWrite = mode === 'modify';
  const tools = makeTools({
    chatId: ctx.chatId,
    currentId: artefactId,
    allowWrite,
  });
  const defs = toolDefs(tools);
  const maxRounds = mode === 'modify' ? MODIFY_MAX_ROUNDS : INSPECT_MAX_ROUNDS;

  const streamPhase: ToolProgress['phase'] = mode === 'inspect' ? 'explaining' : 'building';

  const streamOnce: AgentLoopDeps['streamOnce'] = async (exchange, toolDefsForPass) => {
    return craftStreamOnce({
      base,
      system,
      user,
      exchange,
      tools: toolDefsForPass,
      reasoning: resolved.reasoning,
      signal,
      streamFn: args.streamFn,
      onToken: (charCount) => onProgress?.({ charCount, phase: streamPhase }),
    });
  };

  const loopDispatch: AgentLoopDeps['dispatch'] = async (name, toolArgs, sig) => {
    onProgress?.({ charCount: 0, phase: mapToolPhase(name, mode), detail: name });
    return dispatch(tools, name, toolArgs, sig);
  };

  let loopResult: AgentLoopResult;
  try {
    loopResult = await runLoop({
      streamOnce,
      dispatch: loopDispatch,
      toolDefs: defs,
      maxRounds,
      signal,
      onProgress: (p) => {
        if (p.phase === 'answer') {
          onProgress?.({
            charCount: p.charCount ?? 0,
            phase: mode === 'inspect' ? 'explaining' : 'building',
          });
        } else if (typeof p.charCount === 'number') {
          onProgress?.({ charCount: p.charCount, phase: streamPhase });
        }
      },
      finalRoundNudge:
        mode === 'modify'
          ? 'You have no further tool rounds. Report honestly whether the artefact was fully updated, only partially, or unchanged — and why. Do not invent a successful write.'
          : 'You have no further tool rounds. Answer the question from what you already read. Do not invent file contents.',
    });
  } catch (e) {
    return {
      ok: false,
      output: '',
      error: e instanceof Error ? e.message : 'Artefact craft failed.',
    };
  }

  if (loopResult.stoppedByAbort) {
    return { ok: false, output: '', error: 'Artefact craft was cancelled.' };
  }

  onProgress?.({ charCount: loopResult.finalText.length, phase: 'done' });

  if (mode === 'inspect') {
    const output =
      loopResult.finalText.trim().length > 0
        ? loopResult.finalText
        : 'No explanation was produced.';
    return {
      ok: true,
      output,
      error: null,
      meta: {
        artefactId: row.id,
        title: row.title,
        format: row.format,
      },
    };
  }

  // modify
  const complete = completeFromLedger(loopResult);
  const replaceMeta = lastSuccessfulReplaceMeta(loopResult);
  if (complete === 'complete' || (complete === 'partial' && replaceMeta.updatedAt != null)) {
    void queryClient.invalidateQueries({ queryKey: QK.chatArtefacts(ctx.chatId) });
  }

  // Prefer live title after optional rename.
  let title = row.title;
  let updatedAt = replaceMeta.updatedAt;
  if (replaceMeta.updatedAt != null) {
    const after = await getClientDataDb().artefacts.get(artefactId);
    if (after) {
      title = after.title;
      updatedAt = after.updatedAt;
    }
  }

  const finalText = loopResult.finalText.trim();
  const output =
    finalText.length > 0
      ? finalText
      : complete === 'complete'
        ? `Updated artefact «${title}».`
        : complete === 'no-change'
          ? `No change applied to artefact «${title}».`
          : `Partial update for artefact «${title}».`;

  return {
    ok: true,
    output,
    error: null,
    meta: {
      artefactId: row.id,
      title,
      format: row.format,
      complete,
      ...(updatedAt != null ? { updatedAt } : {}),
    },
  };
}

/** Modify path — thin alias over `runCraft`. */
export function runCraftModify(args: Omit<CraftRunArgs, 'mode'>): Promise<ToolResult> {
  return runCraft({ ...args, mode: 'modify' });
}

/** Inspect path — thin alias over `runCraft`. */
export function runCraftInspect(args: Omit<CraftRunArgs, 'mode'>): Promise<ToolResult> {
  return runCraft({ ...args, mode: 'inspect' });
}
