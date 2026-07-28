// SPDX-License-Identifier: AGPL-3.0-only

import { type CanonicalModel, effectiveFreedom } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import {
  type FamilyGroup,
  type PickerModel,
  buildPickerData,
  filterGroupsByQuery,
  groupModelsByFamily,
} from '../../src/components/model-picker/model-picker-data.js';

/** Minimal configured-provider row; buildPickerData only reads id/templateId/enabled. */
function providerRow(id: string, templateId: string): ProviderRow {
  return { id, templateId, enabled: true } as unknown as ProviderRow;
}

function canonical(id: string, displayName: string, family: string): CanonicalModel {
  return {
    id,
    displayName,
    family,
    requiredCaps: { tools: false, reasoning: false, vision: false },
    freedomOriented: null,
  };
}

function model(displayName: string, family: string, sortPriority: number): PickerModel {
  return {
    canonical: canonical(displayName.toLowerCase().replaceAll(' ', '-'), displayName, family),
    offers: [],
    teeAvailable: false,
    zdrAvailable: false,
    sortPriority,
  };
}

describe('groupModelsByFamily', () => {
  it('buckets models by family, families ordered by lowest sortPriority then name', () => {
    const groups = groupModelsByFamily([
      model('Opus', 'claude', 5),
      model('DeepSeek V4', 'deepseek', 1),
      model('Haiku', 'claude', 9),
      model('GLM 5', 'glm', 1),
    ]);
    // deepseek (1) and glm (1) tie on priority → alphabetical; claude (5) last.
    expect(groups.map((g) => g.family)).toEqual(['deepseek', 'glm', 'claude']);
    const claude = groups.find((g) => g.family === 'claude') as FamilyGroup;
    // Within a family, input order is preserved (curated catalogue order).
    expect(claude.models.map((m) => m.canonical.displayName)).toEqual(['Opus', 'Haiku']);
  });
});

describe('filterGroupsByQuery', () => {
  const base = groupModelsByFamily([
    model('Claude Opus 4.8', 'claude', 5),
    model('Claude Haiku', 'claude', 5),
    model('DeepSeek V4', 'deepseek', 1),
  ]);

  it('returns all groups unchanged for an empty or whitespace query', () => {
    expect(filterGroupsByQuery(base, '')).toEqual(base);
    expect(filterGroupsByQuery(base, '   ')).toEqual(base);
  });

  it('matches case-insensitively, trimmed, by substring on displayName', () => {
    const r = filterGroupsByQuery(base, '  OPUS ');
    expect(r).toHaveLength(1);
    expect(r[0]?.family).toBe('claude');
    expect(r[0]?.models.map((m) => m.canonical.displayName)).toEqual(['Claude Opus 4.8']);
  });

  it('drops families whose every model is filtered out', () => {
    const r = filterGroupsByQuery(base, 'deepseek');
    expect(r.map((g) => g.family)).toEqual(['deepseek']);
  });
});

// These run against the real (pure, no-I/O) catalogue, exercising the data
// behaviours the old inline-ModelList DOM tests used to assert — now decoupled
// from any markup.
describe('buildPickerData', () => {
  it('hides every model when no provider is configured, counting them all', () => {
    const data = buildPickerData([], [], 'all');
    expect(data.groups).toEqual([]);
    expect(data.hiddenCount).toBeGreaterThan(0);
  });

  it('surfaces only canonicals a configured provider offers, hiding the rest', () => {
    const data = buildPickerData([providerRow('pr-mistral', 'mistral')], ['mistral'], 'all');
    const names = data.groups.flatMap((g) => g.models.map((m) => m.canonical.displayName));
    expect(names).toContain('Mistral Large 3');
    expect(names).not.toContain('GLM 5.1'); // mistral does not offer it
    expect(data.hiddenCount).toBeGreaterThan(0);
  });

  it('counts only configured-provider deployments per model', () => {
    const data = buildPickerData([providerRow('pr-mistral', 'mistral')], ['mistral'], 'all');
    const large3 = data.groups
      .flatMap((g) => g.models)
      .find((m) => m.canonical.displayName === 'Mistral Large 3');
    expect(large3).toBeDefined();
    expect(large3?.offers).toHaveLength(1);
  });

  it('returns only vision-capable models under the vision filter', () => {
    const data = buildPickerData([providerRow('pr-mistral', 'mistral')], ['mistral'], 'vision');
    expect(data.groups.length).toBeGreaterThan(0);
    for (const g of data.groups) {
      for (const m of g.models) {
        expect(m.offers.some((o) => o.offering.profile.vision)).toBe(true);
      }
    }
  });

  it('flags TEE availability from a TEE-backed deployment', () => {
    const data = buildPickerData([providerRow('pr-chutes', 'chutes')], ['chutes'], 'all');
    const models = data.groups.flatMap((g) => g.models);
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.teeAvailable)).toBe(true);
  });

  describe('background-worker filter', () => {
    // wafer offers DeepSeek (flagged) and GLM/Kimi (free) — no censored models.
    // It carried Qwen (unknown freedom) as the third case until 2026-07-28, when
    // the offering was removed after wafer withdrew its ZDR. The "unknown
    // survives" half of the rule therefore lives in the nano-gpt test below,
    // asserted structurally so it cannot expire with the catalogue again.
    it('excludes flagged models but keeps the free ones', () => {
      const all = buildPickerData([providerRow('pr-wafer', 'wafer')], ['wafer'], 'all');
      const bg = buildPickerData(
        [providerRow('pr-wafer', 'wafer')],
        ['wafer'],
        'background-worker',
      );
      const famAll = all.groups.map((g) => g.family);
      const famBg = bg.groups.map((g) => g.family);

      expect(famAll).toContain('deepseek'); // wafer offers it under 'all'
      expect(famBg).not.toContain('deepseek'); // …a think-then-stop model can't be its own helper
      expect(famBg).toContain('glm'); // 'free' stays
    });

    // nano-gpt additionally offers Claude + ChatGPT. Every ChatGPT deployment is
    // 'restricted', as is most of the Claude family — but Claude Opus 5 carries
    // freedomOriented: null ('unknown'), so it survives exactly like Qwen above.
    // Assert the rule, not a snapshot of the catalogue: the family thins out, and
    // nothing restricted gets through.
    it('excludes restricted (censored) deployments, keeping the survivors non-restricted', () => {
      const all = buildPickerData([providerRow('pr-nano', 'nano-gpt')], ['nano-gpt'], 'all');
      const bg = buildPickerData(
        [providerRow('pr-nano', 'nano-gpt')],
        ['nano-gpt'],
        'background-worker',
      );
      expect(all.groups.map((g) => g.family)).toEqual(
        expect.arrayContaining(['claude', 'chatgpt', 'deepseek']),
      );
      const bgFam = bg.groups.map((g) => g.family);
      expect(bgFam).not.toContain('chatgpt');
      expect(bgFam).not.toContain('deepseek');

      // Claude survives only through its non-restricted deployments, so the
      // family must come through strictly thinner than under 'all'.
      const claudeAll = all.groups.find((g) => g.family === 'claude')?.models.length ?? 0;
      const claudeBg = bg.groups.find((g) => g.family === 'claude')?.models.length ?? 0;
      expect(claudeAll).toBeGreaterThan(0);
      expect(claudeBg).toBeLessThan(claudeAll);

      // Invariant: every surviving offering resolves as non-restricted.
      for (const g of bg.groups) {
        for (const m of g.models) {
          for (const o of m.offers) {
            expect(
              effectiveFreedom(m.canonical.freedomOriented, o.offering.freedomOrientedDeployment),
            ).not.toBe('restricted');
          }
        }
      }

      // The other half of the rule (Chris 2026-07-15): an UNASSESSED model is
      // not excluded — absence of evidence is not evidence of restriction. Stated
      // structurally rather than by naming a model, because the previous version
      // of this assertion named Qwen and expired when that offering was removed.
      const unknownIds = all.groups
        .flatMap((g) => g.models)
        .filter((m) =>
          m.offers.some(
            (o) =>
              effectiveFreedom(
                m.canonical.freedomOriented,
                o.offering.freedomOrientedDeployment,
              ) === 'unknown',
          ),
        )
        .map((m) => m.canonical.id);
      expect(unknownIds.length).toBeGreaterThan(0); // the fixture must still exercise the case
      const bgIds = new Set(bg.groups.flatMap((g) => g.models).map((m) => m.canonical.id));
      for (const id of unknownIds) expect(bgIds).toContain(id);
    });

    it("leaves the 'all' filter's model set unchanged", () => {
      const allWafer = buildPickerData([providerRow('pr-wafer', 'wafer')], ['wafer'], 'all');
      // 'all' keeps every family wafer offers, flagged ones included.
      expect(allWafer.groups.map((g) => g.family)).toEqual(
        expect.arrayContaining(['deepseek', 'glm', 'kimi']),
      );
    });
  });
});
