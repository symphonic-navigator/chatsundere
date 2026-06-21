// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseExtractionOutput } from '../../src/memory/extraction-parse.js';

describe('parseExtractionOutput', () => {
  it('returns [] for empty / whitespace / null input', () => {
    expect(parseExtractionOutput('')).toEqual([]);
    expect(parseExtractionOutput('   ')).toEqual([]);
    expect(parseExtractionOutput(null)).toEqual([]);
  });

  it('parses a clean JSON array', () => {
    const out = parseExtractionOutput(
      '[{"content":"User enjoys fruit tea","category":"preference","is_correction":false}]',
    );
    expect(out).toEqual([
      { content: 'User enjoys fruit tea', category: 'preference', isCorrection: false },
    ]);
  });

  it('strips a ```json fence and repairs a trailing comma', () => {
    const out = parseExtractionOutput('```json\n[{"content":"A","category":"fact"},]\n```');
    expect(out).toEqual([{ content: 'A', category: 'fact', isCorrection: false }]);
  });

  it('falls back to object-scan on a broken array', () => {
    const out = parseExtractionOutput('garbage {"content":"B","is_correction":true} trailing');
    expect(out).toEqual([{ content: 'B', category: null, isCorrection: true }]);
  });

  it('drops blank-content entries and unknown categories → null', () => {
    const out = parseExtractionOutput(
      '[{"content":"","category":"x"},{"content":"C","category":"weird"}]',
    );
    expect(out).toEqual([{ content: 'C', category: null, isCorrection: false }]);
  });

  it('returns [] for unparseable prose', () => {
    expect(parseExtractionOutput('I could not find anything to extract.')).toEqual([]);
  });
});
