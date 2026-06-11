// SPDX-License-Identifier: LGPL-3.0-only

import {
  NSFW_PROMPT,
  ROLEPLAY_BEHAVIOUR_PROMPT,
  ROLEPLAY_NSFW_PROMPT,
  TONALITY_PROMPT,
  roleplayFormattingPrompt,
} from './identity/chatsundere-identity.js';
import { TEAL_EXPRESSION_PROMPT } from './teal/teal.js';

/** The job a prompt is being built for. `chat` is the main conversation turn;
 *  `title` drives title generation; `memory` is reserved for memory extraction;
 *  `greeting` drives the opener generation (Band 1 + About Me only). */
export type PromptJob = 'chat' | 'title' | 'memory' | 'greeting';

/** Resolved per-turn inputs the builder turns into segment content. */
export interface BuildPromptInputs {
  /** Persona toggle — `chatsundereTonality`. Injects the built-in Tonality text. */
  tonalityEnabled: boolean;
  /** Persona toggle — `adultPersona`. Injects the built-in NSFW text. */
  nsfwEnabled: boolean;
  /** Global user-authored instructions (the former "unlocker"). */
  globalInstructions: string;
  /** Persona instructions. Must be non-empty. */
  personaInstructions: string;
  /** Resolved about-me text (persona override or global). */
  aboutMe: string;
  /** Reserved slot — no producer yet. */
  projectInstructions: string;
  /** Reserved slot — no producer yet. */
  memoryContext: string;
  /** Band-2 phrase-triggered lore (chat only); empty when nothing fired. */
  loreContext?: string;
  /** Band-2 knowledge-libraries awareness (chat only); empty when none assigned. */
  knowledgeLibrariesContext?: string;
  /** Band-3 tools segment — joined tool system-prompt instructions (chat only). */
  toolsInstruction: string;
  /** Persona toggle — roleplay mode. Injects the curated roleplay blocks. */
  roleplayEnabled?: boolean;
  /** Narration perspective for the roleplay formatting block. Default 'first'. */
  narration?: 'first' | 'third';
  /** Persona display name — templated into the third-person narration example. */
  personaName?: string;
}

type SegmentId =
  | 'tonality'
  | 'nsfw'
  | 'global'
  | 'teal'
  | 'roleplay'
  | 'persona'
  | 'aboutMe'
  | 'project'
  | 'memories'
  | 'lore'
  | 'knowledgeLibraries'
  | 'tools';

interface SegmentSpec {
  id: SegmentId;
  band: 1 | 2 | 3;
  order: number;
  jobs: readonly PromptJob[];
  resolve: (i: BuildPromptInputs) => string;
}

const ALL_JOBS: readonly PromptJob[] = ['chat', 'title', 'memory', 'greeting'];
const CHAT_ONLY: readonly PromptJob[] = ['chat'];
const CHAT_AND_GREETING: readonly PromptJob[] = ['chat', 'greeting'];

/**
 * Static segment registry. Band 1 (Behaviour & Voice) runs in every job;
 * Band 2 (Context & Knowledge) runs in chat only (except `aboutMe`, which
 * also runs in `greeting`); Band 3 (Technical — formatting/tools/voice) runs
 * in chat only. The `tools` segment (band 3, order 0) carries joined tool
 * system-prompt instructions when present. The `greeting` job includes Band 1
 * + About Me to drive opener generation; all other Band-2/3 segments are
 * chat-only. See the system-prompt builder spec (2026-06-01) §4–§5.
 */
const SEGMENTS: readonly SegmentSpec[] = [
  {
    id: 'tonality',
    band: 1,
    order: 0,
    jobs: ALL_JOBS,
    resolve: (i) => (i.tonalityEnabled ? TONALITY_PROMPT : ''),
  },
  {
    id: 'nsfw',
    band: 1,
    order: 1,
    jobs: ALL_JOBS,
    resolve: (i) => (i.nsfwEnabled ? NSFW_PROMPT : ''),
  },
  { id: 'global', band: 1, order: 2, jobs: ALL_JOBS, resolve: (i) => i.globalInstructions },
  // Always-on expression layer (TEAL spec 2026-06-11, D1/D9): placed before the
  // roleplay segment so the roleplay → persona adjacency stays intact. Chat and
  // greeting only — title and memory produce no spoken text (D8).
  { id: 'teal', band: 1, order: 3, jobs: CHAT_AND_GREETING, resolve: () => TEAL_EXPRESSION_PROMPT },
  // Runs in every Band-1 job on purpose (roleplay spec 2026-06-11 §4.1): the title job's
  // trailing instruction overrides the embodiment rules in practice — the same
  // mechanism that lets the NSFW segment coexist with title generation.
  {
    id: 'roleplay',
    band: 1,
    order: 4,
    jobs: ALL_JOBS,
    resolve: (i) =>
      i.roleplayEnabled
        ? [
            roleplayFormattingPrompt(i.narration ?? 'first', i.personaName ?? 'the character'),
            ROLEPLAY_BEHAVIOUR_PROMPT,
            ...(i.nsfwEnabled ? [ROLEPLAY_NSFW_PROMPT] : []),
          ].join('\n\n')
        : '',
  },
  { id: 'persona', band: 1, order: 5, jobs: ALL_JOBS, resolve: (i) => i.personaInstructions },
  { id: 'aboutMe', band: 2, order: 0, jobs: CHAT_AND_GREETING, resolve: (i) => i.aboutMe },
  { id: 'project', band: 2, order: 1, jobs: CHAT_ONLY, resolve: (i) => i.projectInstructions },
  { id: 'memories', band: 2, order: 2, jobs: CHAT_ONLY, resolve: (i) => i.memoryContext },
  { id: 'lore', band: 2, order: 3, jobs: CHAT_ONLY, resolve: (i) => i.loreContext ?? '' },
  {
    id: 'knowledgeLibraries',
    band: 2,
    order: 4,
    jobs: CHAT_ONLY,
    resolve: (i) => i.knowledgeLibrariesContext ?? '',
  },
  { id: 'tools', band: 3, order: 0, jobs: CHAT_ONLY, resolve: (i) => i.toolsInstruction },
];

/**
 * Compose the system prompt for a job from the ordered segment registry.
 * Resolves each segment's content, drops segments inactive for the job or
 * resolving to whitespace, sorts by (band, order), and joins with blank
 * lines. Throws when persona instructions are empty.
 */
export function buildPrompt(inputs: BuildPromptInputs, job: PromptJob): string {
  if (inputs.personaInstructions.trim().length === 0) {
    throw new Error('buildPrompt: personaInstructions must be non-empty');
  }
  const parts: string[] = [];
  for (const seg of [...SEGMENTS].sort((a, b) => a.band - b.band || a.order - b.order)) {
    if (!seg.jobs.includes(job)) continue;
    const value = seg.resolve(inputs).trim();
    if (value.length > 0) parts.push(value);
  }
  return parts.join('\n\n');
}
