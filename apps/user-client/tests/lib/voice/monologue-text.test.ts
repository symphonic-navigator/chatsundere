import { describe, expect, it } from 'vitest';
import { chunkForSynthesis, toPlainMonologueText } from '../../../src/lib/voice/monologue-text.js';

describe('toPlainMonologueText', () => {
  it('strips common Markdown markers', () => {
    expect(toPlainMonologueText('I should **really** check `foo` and *bar*')).toBe(
      'I should really check foo and bar',
    );
  });
  it('collapses whitespace and trims', () => {
    expect(toPlainMonologueText('  hmm\n\n  let me   think  ')).toBe('hmm let me think');
  });
  it('drops heading hashes and list bullets', () => {
    expect(toPlainMonologueText('# Plan\n- first\n- second')).toBe('Plan first second');
  });
});

describe('chunkForSynthesis', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkForSynthesis('one two three', 600)).toEqual(['one two three']);
  });
  it('splits on sentence boundaries when over the limit', () => {
    const a = `${'a'.repeat(400)}.`;
    const b = `${'b'.repeat(400)}.`;
    expect(chunkForSynthesis(`${a} ${b}`, 600)).toEqual([a, b]);
  });
  it('drops empty input to an empty array', () => {
    expect(chunkForSynthesis('   ', 600)).toEqual([]);
  });
});
