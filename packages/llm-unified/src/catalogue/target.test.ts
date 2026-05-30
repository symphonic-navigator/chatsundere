// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { chutes } from '../providers/chutes.js';
import { nanoGpt } from '../providers/nano-gpt.js';
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
    const o = nanoGpt.offerings[0];
    if (!o) throw new Error('nano-gpt has no offerings');
    expect(offeringToTarget(o)).toEqual({ slug: o.upstreamSlug });
  });
});
