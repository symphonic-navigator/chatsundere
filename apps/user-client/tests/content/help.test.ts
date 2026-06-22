// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderThirdPartyMarkdown } from '../../src/content/about/third-party.js';
import { AGPL_MD, HELP_DOCS, PRIVACY_MD } from '../../src/content/help/index.js';

describe('content layer', () => {
  it('has a non-empty help doc with a heading for every key', () => {
    for (const [key, doc] of Object.entries(HELP_DOCS)) {
      expect(doc.markdown.length, key).toBeGreaterThan(20);
      expect(doc.markdown, key).toMatch(/^#\s/m);
      expect(doc.title, key).toMatch(/help/i);
    }
  });
  it('my-account help mentions the sub-pages', () => {
    const md = HELP_DOCS['my-account'].markdown;
    for (const word of ['Biometric', 'Recovery', 'Server linking', 'About', 'Logout']) {
      expect(md).toContain(word);
    }
  });
  it('privacy + AGPL are bundled and non-trivial', () => {
    expect(PRIVACY_MD).toMatch(/Privacy/);
    expect(PRIVACY_MD).toContain('ciphertext');
    expect(AGPL_MD.length).toBeGreaterThan(30_000);
  });
  it('third-party renders a bullet list from the structured data', () => {
    const md = renderThirdPartyMarkdown();
    expect(md).toMatch(/^#\sThird-party/m);
    expect(md).toMatch(/- \*\*.+\*\* `v.+`/);
  });
});
