import { describe, expect, it } from 'bun:test';
import { buildAnalyzerPrompt, extractAdapterModule } from './analyzer.js';
import type { CapturedFixture } from './fixture-types.js';

const fixtures: CapturedFixture[] = [
  {
    probeId: 'reasoning-on',
    dimension: 'reasoning-on',
    requestBody: { model: 't' },
    status: 200,
    rawResponse: 'data: {"choices":[{"delta":{"reasoning":"x"}}]}\n\n',
  },
];

describe('buildAnalyzerPrompt', () => {
  it('embeds the contract, the fixtures and an explicit single-code-block instruction', () => {
    const prompt = buildAnalyzerPrompt({
      contract: 'CONTRACT_TEXT',
      providerDocs: 'DOCS',
      fixtures,
    });
    expect(prompt).toContain('CONTRACT_TEXT');
    expect(prompt).toContain('reasoning-on');
    expect(prompt).toContain('"reasoning":"x"');
    expect(prompt.toLowerCase()).toContain('single');
  });
});

describe('extractAdapterModule', () => {
  it('pulls the fenced code block from the model reply', () => {
    const reply = 'Here you go:\n```ts\nexport const adapter = {};\n```\nDone.';
    expect(extractAdapterModule(reply)).toBe('export const adapter = {};');
  });

  it('throws when no code block is present', () => {
    expect(() => extractAdapterModule('no code here')).toThrow(/no code block/i);
  });
});
