// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { chutes } from '../providers/chutes.js';
import { ollamaCloud } from '../providers/ollama-cloud.js';
import { offeringToTarget } from './target.js';

describe('offeringToTarget', () => {
  test('catalogue adapter → slug + adapterId', () => {
    const o = chutes.offerings[0];
    if (!o) throw new Error('chutes has no offerings');
    expect(offeringToTarget(o)).toEqual({
      slug: o.upstreamSlug,
      adapterId: `chutes:${o.upstreamSlug}`,
    });
  });
  test('generic adapter → slug only', () => {
    // ollama-cloud is still on the generic path; nano-gpt/novita/chutes are all
    // live-curated catalogue adapters now.
    const o = ollamaCloud.offerings[0];
    if (!o) throw new Error('ollama-cloud has no offerings');
    expect(offeringToTarget(o)).toEqual({ slug: o.upstreamSlug });
  });
});
