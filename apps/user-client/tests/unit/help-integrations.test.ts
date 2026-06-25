// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { HELP_DOCS } from '../../src/content/help/index.js';

describe('integrations help', () => {
  it('registers a non-empty Integrations help doc', () => {
    const doc = HELP_DOCS.integrations;
    expect(doc).toBeDefined();
    expect(doc.title).toMatch(/integrations/i);
    expect(doc.markdown.length).toBeGreaterThan(50);
  });
});
