// SPDX-License-Identifier: AGPL-3.0-only

export interface SourceMessage {
  role: 'user' | 'persona';
  text: string;
  refs: string[];
}

/** Ported verbatim from chatsune (spec §4.3). */
export const COMPACTION_SYSTEM_PROMPT = `You are a conversation-compaction assistant. Below is a transcript of a conversation between a user and an AI assistant. Your job is to extract a structured briefing that allows another AI to seamlessly continue this conversation in a new context window.

Output rules:
- Output Markdown only. No preamble, no "I have summarised", no meta-commentary.
- Use the exact section headings shown below, in order.
- Be terse but complete. Aim for 5–10 % of the original token count.
- Preserve the user's language preferences, name, and any established facts about them.
- Quote critical user phrasings verbatim if they carry intent (e.g. preferences, decisions).
- Do not invent information. If a section has no content, write "_(none)_".

Required sections:

## Topic & Goal
What is this conversation about? What is the user trying to achieve?

## Established Facts
Concrete facts, decisions, names, numbers, conclusions reached. Bullet list.

## Open Threads
Questions left unanswered, things the user said they would come back to.

## User Preferences Observed
Communication style, expertise level, language preferences, anything that should shape how the next AI responds.

## Pending References
Files, URLs, artefacts, tools that the user mentioned and that the next assistant should know about. Do not paste their content — just reference them by name.

## Tone & Persona Adherence
One sentence on how the persona has been speaking (formal/informal, etc.).`;

export const COMPACTION_RETRY_REMINDER =
  '\n\nIMPORTANT: The previous attempt was missing required sections. Output MUST contain all six headings exactly as specified, in the order shown.';

const REQUIRED_SECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/topic.+goal/i, 'Topic & Goal'],
  [/established.+facts?/i, 'Established Facts'],
  [/open.+threads?/i, 'Open Threads'],
  [/(user.+preferences?|preferences? observed)/i, 'User Preferences Observed'],
  [/pending.+references?/i, 'Pending References'],
  [/(tone.+persona|persona.+adherence)/i, 'Tone & Persona Adherence'],
];

export function validateSummary(markdown: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [pattern, label] of REQUIRED_SECTIONS) {
    if (!pattern.test(markdown)) missing.push(label);
  }
  return { ok: missing.length === 0, missing };
}

/** Build the transcript fed to the summariser. Tool output is already excluded
 *  upstream (only user/persona text reaches here); refs are surfaced as hints. */
export function buildCompactionTranscript(
  source: SourceMessage[],
  previousSummary: string | null,
): string {
  const lines: string[] = [];
  if (previousSummary) {
    lines.push(
      '## Previous Story (from earlier checkpoint)',
      '',
      previousSummary.trim(),
      '',
      '---',
      '',
      '## Conversation since the previous checkpoint',
      '',
    );
  }
  for (const m of source) {
    const speaker = m.role === 'user' ? 'User' : 'Assistant';
    const refSuffix = m.refs.length ? ` ${m.refs.map((r) => `[${r}]`).join(' ')}` : '';
    lines.push(`${speaker}: ${m.text}${refSuffix}`, '');
  }
  return lines.join('\n');
}
