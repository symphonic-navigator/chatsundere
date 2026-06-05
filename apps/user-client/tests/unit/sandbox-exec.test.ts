import { describe, expect, it } from 'vitest';
import { executeCode } from '../../src/tools/sandbox-exec.js';

const CAP = 4096;

describe('executeCode', () => {
  it('returns the completion value of the final expression', () => {
    const r = executeCode('2 + 2', CAP);
    expect(r.value).toBe('4');
    expect(r.stdout).toBe('');
    expect(r.error).toBeNull();
  });

  it('returns the value of the last statement after declarations', () => {
    expect(executeCode('const x = 5; x * x', CAP).value).toBe('25');
  });

  it('captures console.* output and the value together', () => {
    const r = executeCode(
      'console.log("r count", [..."strawberry"].filter(c => c === "r").length); 99',
      CAP,
    );
    expect(r.stdout).toBe('r count 3');
    expect(r.value).toBe('99');
  });

  it('reports undefined value when the program has none', () => {
    const r = executeCode('console.log("hi")', CAP);
    expect(r.stdout).toBe('hi');
    expect(r.value).toBeUndefined();
  });

  it('shadows dangerous globals to undefined (no network in the sandbox)', () => {
    expect(executeCode('typeof fetch', CAP).value).toBe('"undefined"');
  });

  it('surfaces a thrown error as a Name: message string', () => {
    const r = executeCode('throw new RangeError("nope")', CAP);
    expect(r.error).toBe('RangeError: nope');
    expect(r.value).toBeUndefined();
  });

  it('caps console output and appends a truncation marker', () => {
    const r = executeCode('for (let i = 0; i < 100000; i++) console.log("x".repeat(50))', 200);
    expect(r.stdout.length).toBeLessThanOrEqual(200 + ' ... (output truncated)'.length);
    expect(r.stdout.endsWith(' ... (output truncated)')).toBe(true);
  });

  it('stringifies object values as JSON', () => {
    expect(executeCode('({ a: 1, b: [2, 3] })', CAP).value).toBe('{"a":1,"b":[2,3]}');
  });
});
