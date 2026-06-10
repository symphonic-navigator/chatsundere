// SPDX-License-Identifier: LGPL-3.0-only
import { listOfferings } from '../registry.js';
import type { CanonicalModel } from './types.js';

/** Curated, provider-independent identities. The user picks one of these. */
export const CANONICALS: CanonicalModel[] = [
  {
    id: 'deepseek-v3.2',
    displayName: 'DeepSeek V3.2',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'DeepSeek open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'DeepSeek open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'DeepSeek open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'glm-5',
    displayName: 'GLM 5',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote:
      'z-ai/Zhipu open-weight model; judged freedom-oriented for Chatsundere by Chris (2026-05-30).',
  },
  {
    id: 'glm-5.1',
    displayName: 'GLM 5.1',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote:
      'z-ai/Zhipu open-weight model; judged freedom-oriented for Chatsundere by Chris (2026-05-30).',
  },
  {
    id: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote: 'Moonshot open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'gemma-4-31b',
    displayName: 'Gemma 4 31B',
    family: 'gemma',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote: 'Google open-weight model; judged freedom-oriented by Chris (2026-05-30).',
  },
  {
    id: 'qwen3.5-397b-a17b',
    displayName: 'Qwen3.5 397B A17B',
    family: 'qwen',
    // Wafer's /models reports reasoning:false, but the live probe contradicts it
    // (empirical truth over docs, CLAUDE.md §13): `reasoning_effort:medium`
    // yields ~4.7k reasoning tokens, `none` yields zero — a clean on/off toggle.
    // So reasoning IS a required capability. MoE, 397B total / 17B active.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    // Freedom not yet assessed by Chris (2026-05-31) — badge resolves to
    // 'unknown' until judged. Alibaba open-weight family.
    freedomOriented: null,
  },
  {
    id: 'mimo-v2.5-omni',
    displayName: 'MiMo V2.5 Omni',
    family: 'mimo',
    // Omni is natively multimodal and vision works on novita: 100% on real
    // photos, ~88% on the suite's synthetic solid-colour image (the rare miss is
    // a reasoning-leak artefact of that image, not a fault — see the Model
    // Curation Record). Caveats: image input must be a base64 data URL (remote
    // URLs 400), and the model is verbose on synthetic images so a tight
    // max_tokens can truncate before the answer — the adapter sends none.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'Xiaomi open-weight omni-modal model; judged freedom-oriented by Chris (2026-05-31).',
  },
  {
    id: 'mimo-v2.5-pro',
    displayName: 'MiMo V2.5 Pro',
    family: 'mimo',
    // Pro is TEXT-ONLY — novita rejects image_url with "model features vision
    // not support" (input_modalities: [text]). Agentic/long-horizon coding focus.
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
    freedomNote: 'Xiaomi open-weight agentic model; judged freedom-oriented by Chris (2026-05-31).',
  },
  {
    id: 'mistral-small-4',
    displayName: 'Mistral Small 4',
    family: 'mistral',
    // Reasoning is a binary toggle on the Mistral API (reasoning_effort
    // high/none); thinking arrives inside delta.content as a polymorphic
    // typed-item array, not in reasoning_content. Vision + tools confirmed in
    // the chatsune integration. Context window 256k.
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'Mistral flagship; judged freedom-oriented by Chris (2026-05-31): uncensored and notably liberal towards adult expression (more so than the open-weight Chinese models), with licences permissive enough for our API integration.',
  },
  {
    id: 'mistral-medium-3-5',
    displayName: 'Mistral Medium 3.5',
    family: 'mistral',
    // Same reasoning toggle as Small 4. Note the upstream slug is the literal
    // `mistral-medium-3-5`, NOT `-latest` (small/large use `-latest`).
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'Mistral flagship; judged freedom-oriented by Chris (2026-05-31): uncensored and notably liberal towards adult expression, with licences permissive enough for our API integration.',
  },
  {
    id: 'mistral-large-3',
    displayName: 'Mistral Large 3',
    family: 'mistral',
    // Large 3 has NO reasoning (chatsune: has_reasoning=False). Vision + tools.
    requiredCaps: { tools: true, reasoning: false, vision: true },
    freedomOriented: true,
    freedomNote:
      'Mistral flagship; judged freedom-oriented by Chris (2026-05-31): uncensored and notably liberal towards adult expression, with licences permissive enough for our API integration.',
  },
  // --- Claude (Anthropic) — via OpenRouter only; censored at source → not
  // freedom-oriented; surfaced with the CENSORED badge. See ADR 0032. ---
  {
    id: 'claude-haiku-4.5',
    displayName: 'Claude Haiku 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-4.5',
    displayName: 'Claude Sonnet 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-sonnet-4.6',
    displayName: 'Claude Sonnet 4.6',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.5',
    displayName: 'Claude Opus 4.5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.6',
    displayName: 'Claude Opus 4.6',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.7',
    displayName: 'Claude Opus 4.7',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-opus-4.8',
    displayName: 'Claude Opus 4.8',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    family: 'claude',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: false,
    freedomNote:
      'Anthropic aligns/censors the model at source → not freedom-oriented. SM-Bench run 2adbdf74 (2026-06-09): NSFW (System Prompt) 98.62% clears the canary, but Overfit 34.43%, EQ Boundaries 53.65% and Adversarial (Hostile Logic) 79.51% all miss the 90% bar. Integrated via an anonymising router (LLM-VPN) per ADR 0032; effectiveFreedom is "restricted" → CENSORED badge.',
  },
  {
    id: 'grok-4.3',
    displayName: 'Grok 4.3',
    family: 'grok',
    requiredCaps: { tools: true, reasoning: true, vision: true },
    freedomOriented: true,
    freedomNote:
      'xAI/Grok refuses near-nothing; freedom-oriented model and deployment (Chris, 2026-06-02).',
  },
];

/** Fresh array so callers may sort/filter freely. */
export function listCanonicals(): CanonicalModel[] {
  return [...CANONICALS];
}

/** Returns the canonical with the given id, or `undefined` if not registered. */
export function getCanonical(id: string): CanonicalModel | undefined {
  return CANONICALS.find((c) => c.id === id);
}

/**
 * Canonicals the user can actually use: those with >= 1 offering on a
 * configured (usable) provider. Returns the available list plus the count of
 * hidden canonicals, for the model picker's quiet footer.
 */
export function availableCanonicals(configuredTemplateIds: string[]): {
  available: CanonicalModel[];
  hiddenCount: number;
} {
  const configured = new Set(configuredTemplateIds);
  const all = listCanonicals();
  const available = all.filter((c) =>
    listOfferings(c.id).some((o) => configured.has(o.providerId)),
  );
  return { available, hiddenCount: all.length - available.length };
}
