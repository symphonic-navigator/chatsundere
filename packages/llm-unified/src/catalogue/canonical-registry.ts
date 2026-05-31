// SPDX-License-Identifier: LGPL-3.0-only
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
];

/** Fresh array so callers may sort/filter freely. */
export function listCanonicals(): CanonicalModel[] {
  return [...CANONICALS];
}

/** Returns the canonical with the given id, or `undefined` if not registered. */
export function getCanonical(id: string): CanonicalModel | undefined {
  return CANONICALS.find((c) => c.id === id);
}
