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
];

/** Fresh array so callers may sort/filter freely. */
export function listCanonicals(): CanonicalModel[] {
  return [...CANONICALS];
}

/** Returns the canonical with the given id, or `undefined` if not registered. */
export function getCanonical(id: string): CanonicalModel | undefined {
  return CANONICALS.find((c) => c.id === id);
}
