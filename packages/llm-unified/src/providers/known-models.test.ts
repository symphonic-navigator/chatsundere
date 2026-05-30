// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { chutes } from './chutes.js';
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

describe('chutes knownModels (four curated TEE models)', () => {
  it('carries four models, each with an adapterId, reasoning, tools, contextWindow, vision', () => {
    expect(chutes.knownModels.length).toBe(4);
    expect(new Set(chutes.knownModels.map((m) => m.id)).size).toBe(4);
    for (const m of chutes.knownModels) {
      expect(m.adapterId).toBe(`chutes:${m.id}`);
      expect(m.reasoning).toBeDefined();
      expect(typeof m.contextWindow).toBe('number');
      expect(m.tools).toBe(true);
      expect(typeof m.vision).toBe('boolean');
    }
  });

  it('Kimi and Gemma are vision-capable; DeepSeek and GLM are not', () => {
    const vision = (frag: string) =>
      chutes.knownModels.find((m) => m.id.toLowerCase().includes(frag))?.vision;
    expect(vision('kimi')).toBe(true);
    expect(vision('gemma')).toBe(true);
    expect(vision('deepseek')).toBe(false);
    expect(vision('glm')).toBe(false);
  });
});
