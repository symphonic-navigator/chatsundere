// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  stripTechnicalContent,
} from '../../src/memory/extraction-prompt.js';

describe('stripTechnicalContent', () => {
  it('removes fenced code but keeps surrounding prose', () => {
    const out = stripTechnicalContent('I like tea.\n```js\nconst x = 1;\n```\nAnd cats.');
    expect(out).toContain('I like tea.');
    expect(out).toContain('And cats.');
    expect(out).not.toContain('const x');
  });

  it('removes a timestamped log line', () => {
    const out = stripTechnicalContent('Note:\n2026-04-06 12:00:00 ERROR boom\nStill here.');
    expect(out).not.toContain('ERROR boom');
    expect(out).toContain('Still here.');
  });

  it('returns empty input unchanged', () => {
    expect(stripTechnicalContent('')).toBe('');
  });
});

describe('buildExtractionPrompt', () => {
  it('embeds the instructions, existing memory, journal entries, and numbered messages', () => {
    const p = buildExtractionPrompt({
      memoryBody: 'Likes tea.',
      journalEntries: ['Has a sister'],
      messages: ['I went hiking', 'My cat is called Mimi'],
    });
    expect(p).toContain('memory extraction assistant');
    expect(p).toContain('## Existing Memory');
    expect(p).toContain('Likes tea.');
    expect(p).toContain('- Has a sister');
    expect(p).toContain('[1] I went hiking');
    expect(p).toContain('[2] My cat is called Mimi');
  });

  it('shows placeholders when memory + journal are empty', () => {
    const p = buildExtractionPrompt({ memoryBody: null, journalEntries: [], messages: ['hi'] });
    expect(p).toContain('(No existing memory');
    expect(p).toContain('(None)');
  });

  it('renders a User Guidance section before the messages when guidance is given', () => {
    const out = buildExtractionPrompt({
      memoryBody: null,
      journalEntries: [],
      messages: ['I love sci-fi novels.'],
      userGuidance: 'my reading tastes',
    });
    expect(out).toContain('## User Guidance');
    expect(out).toContain('The user has asked you to focus on: my reading tastes');
    expect(out.indexOf('## User Guidance')).toBeLessThan(
      out.indexOf('## User Messages to Process'),
    );
  });

  it('omits the User Guidance section when guidance is empty or absent', () => {
    const withEmpty = buildExtractionPrompt({
      memoryBody: null,
      journalEntries: [],
      messages: ['x'],
      userGuidance: '   ',
    });
    const without = buildExtractionPrompt({
      memoryBody: null,
      journalEntries: [],
      messages: ['x'],
    });
    expect(withEmpty).not.toContain('## User Guidance');
    expect(without).not.toContain('## User Guidance');
    expect(withEmpty).toBe(without);
  });
});
