// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { PRIVACY_MD } from '../../src/content/help/index.js';
import { SUMMARY_INPUT_MAX_CHARS } from '../../src/lib/tool-replay.js';

describe('privacy text', () => {
  it('names the summary cap the code actually applies', () => {
    expect(PRIVACY_MD).toContain('## Which provider sees what?');
    expect(PRIVACY_MD).toContain(
      `first ${SUMMARY_INPUT_MAX_CHARS.toLocaleString('en-GB')} characters of each result`,
    );
  });

  it('says what the linked server stores and what its relay handles in transit', () => {
    expect(PRIVACY_MD).not.toContain('Our server keeps none of it.');
    expect(PRIVACY_MD).not.toContain('sees ciphertext and nothing more');
    expect(PRIVACY_MD).toContain("Our server stores only encrypted copies it can't read.");
    expect(PRIVACY_MD).toContain(
      'which handles them only in transit and neither logs nor stores them.',
    );
  });
});
