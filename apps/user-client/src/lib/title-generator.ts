// SPDX-License-Identifier: AGPL-3.0-only
import {
  type KnownModel,
  type ProviderConfig,
  type ProviderDefinition,
  type WireMessage,
  composeSystemPrompt,
  runOneShotCompletion,
} from '@chatsundere/llm-unified';
import { type ChatRow, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const TITLE_INSTRUCTION =
  'Generate a 3-5 word title for this conversation in British English. ' +
  'Respond with ONLY the title, no quotes, no punctuation at end.';

// Regex to strip surrounding quote characters. Built via RegExp() to avoid
// esbuild choking on literal Unicode curly-quote codepoints in a regex literal.
// Covers: backtick, straight single/double, curly doubles (U+201C/201D),
// curly singles (U+2018/2019).
const SURROUNDING_QUOTES = /^[`\'"\u201C\u201D\u2018\u2019]+|[`\'"\u201C\u201D\u2018\u2019]+$/g;

/**
 * Strip surrounding straight/smart quotes and back-ticks, collapse
 * consecutive whitespace, trim, cap at 60 chars. Returns null when
 * the result is empty.
 */
export function sanitiseTitle(raw: string): string | null {
  // Trim whitespace first so anchored quote-strip works even when the model
  // returns something like ' "title" ' with leading/trailing spaces.
  const trimmed = raw.trim();
  // Reset lastIndex on the shared regex before each call (global flag retains state).
  SURROUNDING_QUOTES.lastIndex = 0;
  const stripped = trimmed.replace(SURROUNDING_QUOTES, '');
  const collapsed = stripped.trim().replace(/\s+/g, ' ');
  if (!collapsed) return null;
  return collapsed.slice(0, 60);
}

export function fallbackTitle(createdAt: number): string {
  const d = new Date(createdAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `New chat — ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

export interface TitleGenArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  model: KnownModel;
  firstUserMessage: string;
  firstPersonaResponse: string;
  globalUnlocker: string;
  globalAboutMe: string;
}

/**
 * Background title generation. Calls the active persona's provider+model
 * with a tiny prompt that asks for a 3-5 word title. The global unlocker
 * is composed into the system prompt — see `background-jobs-prompt-composition`
 * memory note. On any failure, writes the fallback string.
 */
export async function generateTitleAsync(args: TitleGenArgs): Promise<void> {
  const db = getClientDataDb();
  try {
    const systemPrompt = composeSystemPrompt({
      globalUnlocker: args.globalUnlocker,
      aboutMe: args.globalAboutMe,
      personaInstructions: args.persona.instructions,
      projectInstructions: '',
      memoryContext: '',
    });
    const messages: WireMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: args.firstUserMessage },
      { role: 'assistant', content: args.firstPersonaResponse },
      { role: 'user', content: TITLE_INSTRUCTION },
    ];
    const raw = await runOneShotCompletion({
      provider: args.provider,
      providerConfig: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      model: args.model,
      messages,
      bodyExtras: { temperature: 0.3, max_tokens: 20 },
    });
    const cleaned = sanitiseTitle(raw);
    if (!cleaned) throw new Error('empty title');
    await db.chats.update(args.chat.id, { title: cleaned });
  } catch {
    await db.chats.update(args.chat.id, { title: fallbackTitle(args.chat.createdAt) });
  }
}
