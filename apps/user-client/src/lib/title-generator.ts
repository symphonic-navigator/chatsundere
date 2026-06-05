// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type ProviderConfig,
  type ProviderDefinition,
  type WireMessage,
  buildPrompt,
  formatRetryEvent,
  offeringToTarget,
  runOneShotCompletion,
} from '@chatsundere/llm-unified';
import { type ChatRow, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from '../data/queryKeys.js';
import { queryClient } from './queryClient.js';

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

export const TITLE_INSTRUCTION =
  'Generate a short, descriptive title for the conversation above. ' +
  'Respond with ONLY the title — no quotes, no explanation, no punctuation at the end. ' +
  'Maximum 60 characters. Use the language of the conversation.';

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
  offering: Offering;
  firstUserMessage: string;
  firstPersonaResponse: string;
  globalInstructions: string;
  globalAboutMe: string;
}

/**
 * Background title generation. Calls the active persona's provider+offering
 * with a tiny prompt that asks for a 3-5 word title. The system prompt is
 * assembled via buildPrompt — NSFW text is included only when the persona
 * has adultPersona set. On any failure, writes the fallback string.
 */
export async function generateTitleAsync(args: TitleGenArgs): Promise<void> {
  const db = getClientDataDb();
  try {
    const aboutMe = args.persona.aboutMeOverride?.trim()
      ? args.persona.aboutMeOverride
      : args.globalAboutMe;
    const systemPrompt = buildPrompt(
      {
        tonalityEnabled: args.persona.chatsundereTonality,
        nsfwEnabled: args.persona.adultPersona,
        globalInstructions: args.globalInstructions,
        personaInstructions: args.persona.instructions,
        aboutMe,
        projectInstructions: '',
        memoryContext: '',
        toolsInstruction: '',
      },
      'title',
    );
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
      target: offeringToTarget(args.offering),
      messages,
      // Reasoning off: a title needs none, and on reasoning-capable models it
      // would burn the token budget in the reasoning channel and leave `content`
      // empty. `fixed-on` models (Kimi, GLM, …) reason regardless, so the budget
      // is generous enough to survive a short trace and still emit the title.
      bodyExtras: { temperature: 0.3, max_tokens: 256, reasoning: { enabled: false } },
      onRetry: (e) => console.warn(formatRetryEvent(e)),
    });
    const cleaned = sanitiseTitle(raw);
    if (!cleaned) throw new Error('empty title');
    // Race-guard: if the user manually titled while we were calling the
    // LLM, do not overwrite. See spec §2 Decision 2.
    const current = await db.chats.get(args.chat.id);
    if (current?.title != null) return;
    await db.chats.update(args.chat.id, { title: cleaned });
    invalidateChat(args.chat.id);
  } catch {
    const current = await db.chats.get(args.chat.id);
    if (current?.title != null) return;
    await db.chats.update(args.chat.id, { title: fallbackTitle(args.chat.createdAt) });
    invalidateChat(args.chat.id);
  }
}

/**
 * Wake up TanStack consumers (the Chat-View Topbar, History list, etc.)
 * once the background title write lands in Dexie. Without this, the row
 * is updated but the cached query keeps the old value and the Topbar
 * keeps showing the fallback title. Mirrors what useUpdateChat does in
 * its onSuccess.
 */
function invalidateChat(chatId: string): void {
  void queryClient.invalidateQueries({ queryKey: QK.chat(chatId) });
  void queryClient.invalidateQueries({ queryKey: QK.chats });
}
