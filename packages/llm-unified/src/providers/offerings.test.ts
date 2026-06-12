// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { getCanonical } from '../catalogue/canonical-registry.js';
import { parseCatalogueEntry } from '../catalogue/schema.js';
import { chutes } from './chutes.js';
import { nanoGpt } from './nano-gpt.js';
import { novita } from './novita.js';
import { ollamaCloud } from './ollama-cloud.js';
import { wafer } from './wafer.js';

const PROVIDERS = [chutes, wafer, nanoGpt, novita, ollamaCloud];

describe('provider offerings', () => {
  test('every offering references a known canonical and passes the capability gate', () => {
    for (const p of PROVIDERS) {
      expect(p.offerings.length).toBeGreaterThan(0);
      for (const o of p.offerings) {
        // Web, TTI and voice offerings legitimately have no canonical model reference.
        if (o.serviceKind !== 'llm') continue;
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
    // still on the generic path at `confidence: 'heuristic'`. ollama-cloud now
    // carries a native catalogue adapter (`/api/chat`), so it follows the rule.
    for (const o of [
      ...wafer.offerings,
      ...nanoGpt.offerings,
      ...novita.offerings,
      ...ollamaCloud.offerings,
    ]) {
      expect(o.trust.tee).toBe(false);
      if (o.confidence === 'verified') {
        // TTI and voice offerings are verified but use the generic adapter
        // (image and speech calls bypass the chat-adapter pipeline entirely).
        if (o.serviceKind === 'tti' || o.serviceKind === 'tts' || o.serviceKind === 'stt') {
          expect(o.adapter).toEqual({ kind: 'generic' });
        } else {
          expect(o.adapter).toEqual({
            kind: 'catalogue',
            adapterId: `${o.providerId}:${o.upstreamSlug}`,
          });
        }
      } else {
        expect(o.adapter).toEqual({ kind: 'generic' });
      }
    }
  });
});
