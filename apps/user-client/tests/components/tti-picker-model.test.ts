// SPDX-License-Identifier: AGPL-3.0-only
import type { TtiDescriptor } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  buildPickerFamilies,
  familyTapTarget,
  variantEntries,
} from '../../src/components/image-gen/tti-picker-model.js';

function d(
  family: string,
  variant: string | null,
  over: Partial<TtiDescriptor> = {},
): TtiDescriptor {
  return {
    family,
    variant,
    displayName: variant ? `${family} ${variant}` : family,
    canDoNsfw: false,
    maxCount: 4,
    timeoutMs: 1000,
    aspects: ['1:1'],
    resolutions: null,
    qualities: null,
    priceCents: { '-|-': 1 },
    billing: 'fixed',
    defaults: { aspect: '1:1', resolution: null, quality: null },
    wire: { kind: 'aspect-resolution', sendResolution: false, responseFormat: 'url' },
    perItemModeration: false,
    ...over,
  };
}

const OFFERINGS = [
  { providerId: 'xai', upstreamSlug: 'grok-1', tti: d('Grok Imagine', '1') },
  { providerId: 'nano', upstreamSlug: 'sd-45', tti: d('Seedream', '4.5') },
  {
    providerId: 'nano',
    upstreamSlug: 'sd-flash',
    tti: d('Seedream', '5.0 Flash', { recommended: true }),
  },
  {
    providerId: 'nano',
    upstreamSlug: 'sd-pro',
    tti: d('Seedream', '5.0 Pro', { canDoNsfw: true }),
  },
  { providerId: 'nano', upstreamSlug: 'flux', tti: d('FLUX.3', null) },
  {
    providerId: 'nano',
    upstreamSlug: 'grok-2',
    tti: d('Grok Imagine', '2.0', { recommended: true }),
  },
];

const NAMES: Record<string, string> = { xai: 'xAI', nano: 'nano-gpt' };
const base = {
  offerings: OFFERINGS,
  providerName: (id: string) => NAMES[id] ?? id,
  reasonFor: (id: string) =>
    `${NAMES[id] ?? id} is not set up — add it under Upstream Providers above`,
  nsfwOnly: false,
};

describe('buildPickerFamilies', () => {
  it('groups by family, alphabetically, keeping catalogue order inside', () => {
    const fams = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['xai', 'nano'],
      savedRef: null,
    });
    expect(fams.map((f) => f.family)).toEqual(['FLUX.3', 'Grok Imagine', 'Seedream']);
    expect(fams[1]?.offerings.map((o) => o.ref)).toEqual(['xai:grok-1', 'nano:grok-2']);
  });

  it('keeps families without a usable provider, marked unusable with a reason', () => {
    const fams = buildPickerFamilies({ ...base, usableTemplateIds: ['xai'], savedRef: null });
    const flux = fams.find((f) => f.family === 'FLUX.3');
    expect(flux?.usable).toBe(false);
    expect(flux?.reason).toBe('nano-gpt is not set up — add it under Upstream Providers above');
    expect(fams.find((f) => f.family === 'Grok Imagine')?.usable).toBe(true);
  });

  it('nsfwOnly drops incapable offerings and empty families', () => {
    const fams = buildPickerFamilies({
      ...base,
      nsfwOnly: true,
      usableTemplateIds: ['xai', 'nano'],
      savedRef: null,
    });
    expect(fams.map((f) => f.family)).toEqual(['Seedream']);
    expect(fams[0]?.offerings.map((o) => o.ref)).toEqual(['nano:sd-pro']);
  });

  it('marks the family holding the saved ref as selected', () => {
    const fams = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['nano'],
      savedRef: 'nano:sd-45',
    });
    expect(fams.find((f) => f.selected)?.family).toBe('Seedream');
  });

  it('flags only the family holding an unusable saved offering as stale', () => {
    const fams = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['nano'],
      savedRef: 'xai:grok-1',
    });
    expect(fams.find((f) => f.family === 'Grok Imagine')?.stale).toBe(true);
    expect(fams.filter((f) => f.stale).map((f) => f.family)).toEqual(['Grok Imagine']);
  });

  it('is not stale when the saved offering is usable or absent', () => {
    const usable = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['xai', 'nano'],
      savedRef: 'xai:grok-1',
    });
    expect(usable.some((f) => f.stale)).toBe(false);
    const none = buildPickerFamilies({ ...base, usableTemplateIds: ['nano'], savedRef: null });
    expect(none.some((f) => f.stale)).toBe(false);
  });
});

describe('familyTapTarget', () => {
  const usable = buildPickerFamilies({
    ...base,
    usableTemplateIds: ['xai', 'nano'],
    savedRef: null,
  });
  const seedream = usable.find((f) => f.family === 'Seedream');
  const grok = usable.find((f) => f.family === 'Grok Imagine');

  it('picks the recommended usable variant', () => {
    if (!seedream) throw new Error('fixture');
    expect(familyTapTarget(seedream, null)).toBe('nano:sd-flash');
  });
  it('is a no-op when the saved offering is in the family and usable', () => {
    if (!seedream) throw new Error('fixture');
    expect(familyTapTarget(seedream, 'nano:sd-45')).toBeNull();
  });
  it('falls back to the first usable variant when nothing is recommended', () => {
    const flux = usable.find((f) => f.family === 'FLUX.3');
    if (!flux) throw new Error('fixture');
    expect(familyTapTarget(flux, null)).toBe('nano:flux');
  });
  it('moves a stale saved offering to a usable variant (no closed loop)', () => {
    const stale = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['nano'],
      savedRef: 'xai:grok-1',
    }).find((f) => f.family === 'Grok Imagine');
    if (!stale || !grok) throw new Error('fixture');
    expect(familyTapTarget(stale, 'xai:grok-1')).toBe('nano:grok-2');
  });
  it('returns null for a family with no usable offering', () => {
    const flux = buildPickerFamilies({ ...base, usableTemplateIds: ['xai'], savedRef: null }).find(
      (f) => f.family === 'FLUX.3',
    );
    if (!flux) throw new Error('fixture');
    expect(familyTapTarget(flux, null)).toBeNull();
  });
});

describe('variantEntries', () => {
  it('lists usable variants, suffixing the provider when the row spans providers', () => {
    const grok = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['xai', 'nano'],
      savedRef: 'nano:grok-2',
    }).find((f) => f.family === 'Grok Imagine');
    if (!grok) throw new Error('fixture');
    expect(variantEntries(grok, 'nano:grok-2')).toEqual([
      { ref: 'xai:grok-1', label: '1 · xAI', disabled: false, selected: false, reason: null },
      {
        ref: 'nano:grok-2',
        label: '2.0 · nano-gpt',
        disabled: false,
        selected: true,
        reason: null,
      },
    ]);
  });
  it('omits unusable variants but keeps the stale saved one, greyed, with its reason', () => {
    const grok = buildPickerFamilies({
      ...base,
      usableTemplateIds: ['nano'],
      savedRef: 'xai:grok-1',
    }).find((f) => f.family === 'Grok Imagine');
    if (!grok) throw new Error('fixture');
    expect(variantEntries(grok, 'xai:grok-1')).toEqual([
      {
        ref: 'xai:grok-1',
        label: '1 · xAI',
        disabled: true,
        selected: true,
        reason: 'xAI is not set up — add it under Upstream Providers above',
      },
      {
        ref: 'nano:grok-2',
        label: '2.0 · nano-gpt',
        disabled: false,
        selected: false,
        reason: null,
      },
    ]);
  });
  it('single-provider rows carry no suffix; latencyHint is appended', () => {
    const fams = buildPickerFamilies({
      ...base,
      offerings: [
        { providerId: 'nano', upstreamSlug: 'zt', tti: d('Z-Image', 'Turbo') },
        {
          providerId: 'nano',
          upstreamSlug: 'zb',
          tti: d('Z-Image', 'Base', { latencyHint: '~10× slower' }),
        },
      ],
      usableTemplateIds: ['nano'],
      savedRef: 'nano:zt',
    });
    const z = fams[0];
    if (!z) throw new Error('fixture');
    expect(variantEntries(z, 'nano:zt').map((e) => e.label)).toEqual([
      'Turbo',
      'Base · ~10× slower',
    ]);
  });
});
