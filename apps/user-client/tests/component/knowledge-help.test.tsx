import { describe, expect, it } from 'vitest';
import { HELP_DOCS } from '../../src/content/help/index.js';

describe('knowledge help docs', () => {
  it('registers a help entry for each My Knowledge level', () => {
    for (const key of ['knowledge', 'knowledge-library', 'knowledge-document'] as const) {
      const entry = (HELP_DOCS as Record<string, { title: string; markdown: string }>)[key];
      expect(entry, `missing help for ${key}`).toBeTruthy();
      if (!entry) continue; // TypeScript narrowing guard; the expect above already asserts this
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.markdown.length).toBeGreaterThan(0);
    }
  });
});
