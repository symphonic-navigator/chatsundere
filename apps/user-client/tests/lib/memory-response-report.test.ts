// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatMemoryResponse, hasEmptyContent } from '../../src/lib/memory-response-report.js';

describe('hasEmptyContent', () => {
  it('is true for empty or whitespace-only content', () => {
    expect(hasEmptyContent({ content: '', reasoning: 'x', finishReason: null })).toBe(true);
    expect(hasEmptyContent({ content: '   \n', reasoning: '', finishReason: null })).toBe(true);
  });
  it('is false when content has text', () => {
    expect(hasEmptyContent({ content: 'a body', reasoning: '', finishReason: null })).toBe(false);
  });
});

describe('formatMemoryResponse', () => {
  it('renders both channels and the finish reason', () => {
    const text = formatMemoryResponse({
      content: 'the body',
      reasoning: 'my thoughts',
      finishReason: 'stop',
    });
    expect(text).toContain('Finish reason: stop');
    expect(text).toContain('[Reasoning]\nmy thoughts');
    expect(text).toContain('[Content]\nthe body');
  });

  it('substitutes honest placeholders for the empty channels', () => {
    const text = formatMemoryResponse({ content: '', reasoning: '', finishReason: null });
    expect(text).toContain('Finish reason: (none)');
    expect(text).toContain('(no reasoning returned)');
    expect(text).toContain('(empty — the model returned no content)');
  });
});
