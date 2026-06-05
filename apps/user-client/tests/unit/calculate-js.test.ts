import { describe, expect, it } from 'vitest';
import { assembleOutput, calculateJs } from '../../src/tools/calculate-js.js';

describe('assembleOutput', () => {
  it('combines console output and the final value on its own line', () => {
    expect(assembleOutput({ stdout: 'r count 3', value: '99', error: null })).toBe('r count 3\n99');
  });

  it('returns just the value when there is no console output', () => {
    expect(assembleOutput({ stdout: '', value: '4', error: null })).toBe('4');
  });

  it('returns just the console output when there is no value', () => {
    expect(assembleOutput({ stdout: 'hi', value: undefined, error: null })).toBe('hi');
  });

  it('returns an empty string when there is neither', () => {
    expect(assembleOutput({ stdout: '', value: undefined, error: null })).toBe('');
  });
});

describe('calculateJs definition', () => {
  it('is named calculate_js with a code parameter', () => {
    expect(calculateJs.name).toBe('calculate_js');
    expect((calculateJs.parameters as { required: string[] }).required).toContain('code');
  });

  it('carries a non-null system-prompt instruction', () => {
    expect(calculateJs.systemPromptInstruction).not.toBeNull();
    expect(calculateJs.systemPromptInstruction).toContain('calculate_js');
  });
});
