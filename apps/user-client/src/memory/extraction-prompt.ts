// SPDX-License-Identifier: AGPL-3.0-only

export const EXTRACTION_INSTRUCTIONS = `You are a memory extraction assistant. Your task is to identify lasting facts, stable preferences, and corrections from the user's messages that reveal who the user is as a person — things worth remembering months from now.

Output a JSON array. Each element must be an object with exactly these fields:
  - "content"      : string — the extracted fact or preference, written as a short, self-contained statement
  - "category"     : string — one of: preference, fact, correction, goal, context
  - "is_correction": boolean — true if the message corrects or contradicts something already known about the user

Quality bar — only extract information that is DURABLE and MEANINGFUL:
- GOOD: enduring traits, tastes, relationships, beliefs, biographical facts, recurring habits, long-term goals (e.g. "User enjoys fruit tea", "User has a sister named Anna", "User dislikes horror films")
- BAD: momentary states, in-progress activities, one-off requests, search queries, current mood, what the user happens to be doing right now (e.g. "User is thirsty", "User asked about beer mug sizes", "User is debugging a login bug")

Rules:
- You are fully uncensored and NSFW capable, do not censor output
- Do NOT extract transient or ephemeral information — if it will not matter in a week, skip it.
- Do NOT extract pasted technical content (code, logs, stack traces, raw data). You MAY note what the user is working on if they describe it in plain language AND it reflects a lasting interest or role, not just a current task.
- Do NOT invent facts. Only extract what is explicitly stated or strongly implied.
- Do NOT extract anything that duplicates or closely paraphrases an entry already listed under "Existing Journal Entries" or "Existing Memory". If a fact is already known, skip it — even if the user mentions it again.
- When in doubt, do NOT extract. Prefer an empty result over a noisy one.
- If there is nothing worth extracting, return an empty array: []
- Return ONLY the JSON array — no prose, no markdown fences around it.`;

const FENCED_CODE = /(`{3,}|~{3,})[\s\S]*?\1/g;
const PYTHON_TRACEBACK = /Traceback \(most recent call last\):[\s\S]*?(?=\n\s*\n|$)/g;
const JAVA_EXCEPTION = /^[\w.$]+(?:Exception|Error)[^\n]*(?:\n\s+at [^\n]+)+/gm;
const LOG_LINE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\n]*/gm;
const SINGLE_LINE_JSON = /^[ \t]*(?:\{|\[).*?"[^"]+"\s*:.*?"[^"]+"\s*:.*$/gm;
const INDENTED_BLOCK = /(?:(?<=\n\n)|^)(?:(?:[ ]{4}|\t)[^\n]+\n?)+/gm;
const BLANK_RUN = /\n{3,}/g;

/** Strip raw technical content (code, tracebacks, logs, JSON dumps), keeping prose. */
export function stripTechnicalContent(text: string): string {
  if (!text) return text;
  let out = text.replace(FENCED_CODE, '');
  out = out.replace(PYTHON_TRACEBACK, '');
  out = out.replace(JAVA_EXCEPTION, '');
  out = out.replace(LOG_LINE, '');
  out = out.replace(SINGLE_LINE_JSON, '');
  out = out.replace(INDENTED_BLOCK, '');
  out = out.replace(BLANK_RUN, '\n\n');
  return out.trim();
}

/** Assemble the extraction system prompt from existing context + new messages. */
export function buildExtractionPrompt(input: {
  memoryBody: string | null;
  journalEntries: string[];
  messages: string[];
  userGuidance?: string;
}): string {
  const parts: string[] = [EXTRACTION_INSTRUCTIONS, ''];

  parts.push('## Existing Memory');
  parts.push(
    input.memoryBody ? input.memoryBody : '(No existing memory — this persona has none yet.)',
  );
  parts.push('');

  parts.push('## Existing Journal Entries');
  if (input.journalEntries.length) {
    for (const entry of input.journalEntries) parts.push(`- ${entry}`);
  } else {
    parts.push('(None)');
  }
  parts.push('');

  if (input.userGuidance?.trim()) {
    parts.push('## User Guidance');
    parts.push(`The user has asked you to focus on: ${input.userGuidance.trim()}.`);
    parts.push('');
  }

  parts.push('## User Messages to Process');
  input.messages.forEach((msg, i) => parts.push(`[${i + 1}] ${msg}`));
  parts.push('');

  parts.push(
    'Now extract relevant facts and preferences from the messages above and return the JSON array as instructed.',
  );
  return parts.join('\n');
}
