// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { chutes } from '../providers/chutes.js';
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
    // No built-in ships a generic offering any more (all live-curated →
    // catalogue, incl. ollama-cloud's native adapter), so exercise the generic
    // branch with a synthetic offering.
    const base = chutes.offerings[0];
    if (!base) throw new Error('chutes has no offerings');
    const generic = { ...base, adapter: { kind: 'generic' as const } };
    expect(offeringToTarget(generic)).toEqual({ slug: generic.upstreamSlug });
  });
});
