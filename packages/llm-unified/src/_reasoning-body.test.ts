// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { applyReasoningToBody } from './_reasoning-body.js';

// Real model IDs picked from the actual provider definitions.
// nano-gpt switching modes from NANO_GPT_PAIRS:
const NANO_SLUG_MODEL = 'deepseek/deepseek-v4-pro'; // switchingMode: 'slug'
const NANO_FLAG_MODEL = 'moonshotai/kimi-k2.6'; // switchingMode: 'flag'
// The current pair map has no switchingMode: 'none' entry. The implementation
// treats an unknown model id identically (clean body, modelId unchanged), so
// an unmapped id exercises the same observable contract.
const NANO_NONE_MODEL = 'unknown/no-pair-entry';

// Real Novita and Ollama-Cloud model ids:
const NOVITA_MODEL = 'deepseek/deepseek-v4-pro';
const OLLAMA_MODEL = 'deepseek-v4-pro';

function baseBody(): Record<string, unknown> {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7,
  };
}

describe('applyReasoningToBody', () => {
  describe('nano-gpt', () => {
    it('slug-mode + enabled=true → swaps to thinkingSlug, body clean', () => {
      const result = applyReasoningToBody(
        'nano-gpt',
        NANO_SLUG_MODEL,
        { enabled: true, effort: 'medium' },
        baseBody(),
      );
      expect(result.modelId).toBe('deepseek/deepseek-v4-pro:thinking');
      expect(result.body).not.toHaveProperty('reasoning');
      expect(result.body).not.toHaveProperty('think');
    });

    it('slug-mode + enabled=false → nonThinkingSlug, body clean', () => {
      const result = applyReasoningToBody(
        'nano-gpt',
        NANO_SLUG_MODEL,
        { enabled: false },
        baseBody(),
      );
      expect(result.modelId).toBe('deepseek/deepseek-v4-pro');
      expect(result.body).not.toHaveProperty('reasoning');
      expect(result.body).not.toHaveProperty('think');
    });

    it('flag-mode → body carries reasoning object; modelId unchanged', () => {
      const result = applyReasoningToBody(
        'nano-gpt',
        NANO_FLAG_MODEL,
        { enabled: true, effort: 'high' },
        baseBody(),
      );
      expect(result.modelId).toBe(NANO_FLAG_MODEL);
      expect(result.body.reasoning).toEqual({ enabled: true, effort: 'high' });
    });

    it('flag-mode + enabled=false → body reasoning { enabled: false } without effort', () => {
      const result = applyReasoningToBody(
        'nano-gpt',
        NANO_FLAG_MODEL,
        { enabled: false },
        baseBody(),
      );
      expect(result.modelId).toBe(NANO_FLAG_MODEL);
      expect(result.body.reasoning).toEqual({ enabled: false });
    });

    it('none-mode + enabled=true → body clean, modelId unchanged', () => {
      const result = applyReasoningToBody(
        'nano-gpt',
        NANO_NONE_MODEL,
        { enabled: true, effort: 'low' },
        baseBody(),
      );
      expect(result.modelId).toBe(NANO_NONE_MODEL);
      expect(result.body).not.toHaveProperty('reasoning');
      expect(result.body).not.toHaveProperty('think');
    });

    it('none-mode + enabled=false → body clean, modelId unchanged', () => {
      const result = applyReasoningToBody(
        'nano-gpt',
        NANO_NONE_MODEL,
        { enabled: false },
        baseBody(),
      );
      expect(result.modelId).toBe(NANO_NONE_MODEL);
      expect(result.body).not.toHaveProperty('reasoning');
      expect(result.body).not.toHaveProperty('think');
    });
  });

  describe('novita', () => {
    it('writes body.reasoning when enabled, with effort', () => {
      const result = applyReasoningToBody(
        'novita',
        NOVITA_MODEL,
        { enabled: true, effort: 'medium' },
        baseBody(),
      );
      expect(result.modelId).toBe(NOVITA_MODEL);
      expect(result.body.reasoning).toEqual({ enabled: true, effort: 'medium' });
    });

    it('writes body.reasoning { enabled: false } when disabled', () => {
      const result = applyReasoningToBody('novita', NOVITA_MODEL, { enabled: false }, baseBody());
      expect(result.modelId).toBe(NOVITA_MODEL);
      expect(result.body.reasoning).toEqual({ enabled: false });
    });
  });

  describe('ollama-cloud', () => {
    it('writes body.think = true when enabled (effort silently dropped)', () => {
      const result = applyReasoningToBody(
        'ollama-cloud',
        OLLAMA_MODEL,
        { enabled: true, effort: 'high' },
        baseBody(),
      );
      expect(result.modelId).toBe(OLLAMA_MODEL);
      expect(result.body.think).toBe(true);
      expect(result.body).not.toHaveProperty('reasoning');
    });

    it('writes body.think = false when disabled', () => {
      const result = applyReasoningToBody(
        'ollama-cloud',
        OLLAMA_MODEL,
        { enabled: false },
        baseBody(),
      );
      expect(result.modelId).toBe(OLLAMA_MODEL);
      expect(result.body.think).toBe(false);
      expect(result.body).not.toHaveProperty('reasoning');
    });
  });

  it('preserves pre-existing body fields unrelated to reasoning', () => {
    const result = applyReasoningToBody(
      'novita',
      NOVITA_MODEL,
      { enabled: true, effort: 'low' },
      {
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.42,
        top_p: 0.9,
        stream: true,
      },
    );
    expect(result.body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(result.body.temperature).toBe(0.42);
    expect(result.body.top_p).toBe(0.9);
    expect(result.body.stream).toBe(true);
    expect(result.body.reasoning).toEqual({ enabled: true, effort: 'low' });
  });
});
