// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { nanoGpt } from './nano-gpt.js';
import { novita } from './novita.js';
import { ollamaCloud } from './ollama-cloud.js';

describe('knownModels per provider', () => {
  for (const [name, def] of [
    ['nano-gpt', nanoGpt],
    ['novita', novita],
    ['ollama-cloud', ollamaCloud],
  ] as const) {
    it(`${name} carries six curated models`, () => {
      expect(def.knownModels.length).toBe(6);
      const ids = def.knownModels.map((m) => m.id);
      expect(new Set(ids).size).toBe(6);
    });
    it(`${name} models all declare reasoning + tools + contextWindow + vision`, () => {
      for (const m of def.knownModels) {
        expect(m.reasoning).toBeDefined();
        expect(typeof m.contextWindow).toBe('number');
        expect(typeof m.tools).toBe('boolean');
        expect(typeof m.vision).toBe('boolean');
      }
    });
    it(`${name} Kimi K2.6 and Gemma 4 declare vision true`, () => {
      const kimi = def.knownModels.find((m) => m.id.toLowerCase().includes('kimi'));
      const gemma = def.knownModels.find((m) => m.id.toLowerCase().includes('gemma'));
      expect(kimi?.vision).toBe(true);
      expect(gemma?.vision).toBe(true);
    });
  }
});
