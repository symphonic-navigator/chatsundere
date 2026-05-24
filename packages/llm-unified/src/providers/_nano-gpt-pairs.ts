// SPDX-License-Identifier: LGPL-3.0-only

export type SwitchingMode = 'slug' | 'flag' | 'none';

export interface NanoGptPair {
  nonThinkingSlug: string;
  thinkingSlug: string | null; // null when switchingMode === 'flag' | 'none'
  switchingMode: SwitchingMode;
}

/**
 * nano-gpt expresses reasoning capability through three shapes:
 *   - 'slug': two distinct upstream slugs, e.g. base and base:thinking. Swap
 *     the modelId at request time based on whether reasoning is on.
 *   - 'flag': single slug, a body flag controls thinking. Keep the slug,
 *     toggle the flag.
 *   - 'none': the model has no reasoning controls at all.
 *
 * Provisional entries — the exact slugs MUST be verified live against
 * nano-gpt during Task 3 before this map is considered final.
 */
export const NANO_GPT_PAIRS: Record<string, NanoGptPair> = {
  'deepseek/deepseek-v4-flash': {
    nonThinkingSlug: 'deepseek/deepseek-v4-flash',
    thinkingSlug: 'deepseek/deepseek-v4-flash:thinking',
    switchingMode: 'slug',
  },
  'deepseek/deepseek-v4-pro': {
    nonThinkingSlug: 'deepseek/deepseek-v4-pro',
    thinkingSlug: 'deepseek/deepseek-v4-pro:thinking',
    switchingMode: 'slug',
  },
  'zai-org/glm-5': {
    nonThinkingSlug: 'zai-org/glm-5',
    thinkingSlug: 'zai-org/glm-5:thinking',
    switchingMode: 'slug',
  },
  'zai-org/glm-5.1': {
    nonThinkingSlug: 'zai-org/glm-5.1',
    thinkingSlug: 'zai-org/glm-5.1:thinking',
    switchingMode: 'slug',
  },
  'moonshotai/kimi-k2.6': {
    nonThinkingSlug: 'moonshotai/kimi-k2.6',
    thinkingSlug: null,
    switchingMode: 'flag',
  },
  'google/gemma-4-31b-it': {
    nonThinkingSlug: 'google/gemma-4-31b-it',
    thinkingSlug: null,
    switchingMode: 'flag',
  },
};
