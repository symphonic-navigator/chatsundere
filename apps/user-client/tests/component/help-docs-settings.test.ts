import { describe, expect, it } from 'vitest';
import { HELP_DOCS } from '../../src/content/help/index.js';

describe('settings help docs', () => {
  const keys = [
    'settings',
    'settings-you',
    'settings-providers',
    'settings-web',
    'settings-voice',
    'settings-images',
    'settings-expert',
  ] as const;
  it('registers every settings help key with non-empty markdown', () => {
    for (const k of keys) {
      expect(HELP_DOCS[k]?.markdown.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
