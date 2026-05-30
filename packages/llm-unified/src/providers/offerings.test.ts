// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { getCanonical } from '../catalogue/canonical-registry.js';
import { parseCatalogueEntry } from '../catalogue/schema.js';
import { chutes } from './chutes.js';
import { nanoGpt } from './nano-gpt.js';
import { novita } from './novita.js';
import { ollamaCloud } from './ollama-cloud.js';

const PROVIDERS = [chutes, nanoGpt, novita, ollamaCloud];

describe('provider offerings', () => {
  test('every offering references a known canonical and passes the capability gate', () => {
    for (const p of PROVIDERS) {
      expect(p.offerings.length).toBeGreaterThan(0);
      for (const o of p.offerings) {
        expect(o.providerId).toBe(p.id);
        const canonical = o.canonicalRef ? getCanonical(o.canonicalRef) : undefined;
        expect(canonical).toBeDefined();
        const res = parseCatalogueEntry({ canonical, offerings: [o] });
        if (!res.ok) throw new Error(`${p.id}:${o.upstreamSlug} → ${res.errors.join('; ')}`);
      }
    }
  });

  test('chutes is all TEE; adapter kind tracks confidence (verified↔catalogue, heuristic↔generic)', () => {
    for (const o of chutes.offerings) {
      expect(o.trust.tee).toBe(true);
      expect(o.adapter).toEqual({ kind: 'catalogue', adapterId: `chutes:${o.upstreamSlug}` });
    }
    // The non-TEE providers are mixed: live-curated GLM offerings carry a
    // hand-written catalogue adapter and `confidence: 'verified'`; the rest are
    // still on the generic path at `confidence: 'heuristic'`.
    for (const o of [...nanoGpt.offerings, ...novita.offerings, ...ollamaCloud.offerings]) {
      expect(o.trust.tee).toBe(false);
      if (o.confidence === 'verified') {
        expect(o.adapter).toEqual({
          kind: 'catalogue',
          adapterId: `${o.providerId}:${o.upstreamSlug}`,
        });
      } else {
        expect(o.adapter).toEqual({ kind: 'generic' });
      }
    }
  });
});
