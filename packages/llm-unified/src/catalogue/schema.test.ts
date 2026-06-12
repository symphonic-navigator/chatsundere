// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parseCatalogueEntry } from './schema.js';

const validEntry = {
  canonical: {
    id: 'glm-6',
    displayName: 'GLM 6',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
  },
  offerings: [
    {
      canonicalRef: 'glm-6',
      providerId: 'nano-gpt',
      upstreamSlug: 'zai-org/glm-6',
      adapter: { kind: 'catalogue', adapterId: 'glm-6.nano-gpt' },
      profile: {
        reasoning: { mode: 'toggle', defaultOn: true },
        toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
        vision: false,
        replayReasoning: false,
      },
      context: { recommended: 128000, max: 200000 },
      trust: { tee: false, zdr: false },
      freedomOrientedDeployment: false,
      source: 'curated',
      confidence: 'verified',
    },
  ],
};

describe('parseCatalogueEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(parseCatalogueEntry(validEntry).ok).toBe(true);
  });

  it('rejects an offering that does not deliver a required capability', () => {
    const bad = structuredClone(validEntry);
    // biome-ignore lint/style/noNonNullAssertion: test fixture is guaranteed non-empty
    bad.offerings[0]!.profile.toolCalls.supported = false;
    const r = parseCatalogueEntry(bad);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors.join(' ')).toMatch(/capability gate/i);
  });

  it('rejects an offering that lacks required reasoning (mode none)', () => {
    const bad = structuredClone(validEntry) as unknown as typeof validEntry;
    // biome-ignore lint/style/noNonNullAssertion: fixture is statically non-empty
    (bad.offerings[0]!.profile as Record<string, unknown>).reasoning = { mode: 'none' };
    const r = parseCatalogueEntry(bad);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors.join(' ')).toMatch(/capability gate.*reasoning/i);
  });

  it('rejects an offering that lacks required vision', () => {
    const bad = structuredClone(validEntry);
    bad.canonical.requiredCaps.vision = true; // now vision is required
    // offering profile.vision is false → gate must reject
    const r = parseCatalogueEntry(bad);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors.join(' ')).toMatch(/capability gate.*vision/i);
  });

  it('accepts and surfaces modelInstructions on the canonical', () => {
    const entry = structuredClone(validEntry);
    (entry.canonical as { modelInstructions?: string }).modelInstructions = 'Prefer prose.';
    const r = parseCatalogueEntry(entry);
    expect(r.ok).toBe(true);
    expect(r.ok ? r.entry.canonical.modelInstructions : undefined).toBe('Prefer prose.');
  });

  it('rejects a structurally invalid entry', () => {
    expect(parseCatalogueEntry({ canonical: { id: 'x' } }).ok).toBe(false);
  });
});
