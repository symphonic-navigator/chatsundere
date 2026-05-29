# Curation CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the maintainer "model-support factory" — a declarative CLI (`curate`) that scans a provider's models, emits a fill-in YAML template per model, runs the synthesis engine to generate + validate per-offering adapters on `build`, writes the generated half back into the YAML and the adapter as a sibling `.ts`, and renders a deterministic Obsidian report.

**Architecture:** A new `packages/llm-unified/src/curate/` subtree, maintainer-only (not exported from the package index, so excluded from the client bundle). It composes the existing `synthesis/` engine (probe → generate → validate → self-repair) per offering and the `catalogue/` types. A per-provider `ProviderScanner` (hand-written, nano-gpt first) tames the upstream slug zoo. Model files are round-tripped with the comment-preserving `yaml` package: human-input above, generated `built:` block below.

**Tech Stack:** TypeScript (strict), Bun (runtime + test + Worker), `yaml` (new dep, comment-preserving round-trip), Valibot (model-file validation), Biome. Reuses `synthesis/` and `catalogue/` from prior plans.

**Spec:** `superpowers/specs/2026-05-29-curation-cli-design.md`

**Conventions:** British English. Free-form imperative commits, trailer `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. `bunx @biomejs/biome check --write <files>` before every commit. Tests: `cd packages/llm-unified && bun test`. Typecheck: `pnpm --filter @chatsundere/llm-unified typecheck`.

**File map (`packages/llm-unified/src/curate/`):**
- `model-file.ts` — `ModelFile`/`HumanOffering`/`BuiltOffering` types + Valibot schema + `parseModelFile` + `assembleOfferings` + `renderTemplate`.
- `write-back.ts` — comment-preserving write of the `built:` block into a model YAML (the `yaml` Document API).
- `provider-scanner.ts` — `ProviderScanner` interface + `nanoGptScanner` (slug-zoo grouping).
- `report.ts` — deterministic Markdown render of an assembled model.
- `build.ts` — per-offering orchestration over the synthesis loop (dependency-injected for tests).
- `cli.ts` — argv dispatch for the sub-commands + `--help`; the only file that does real I/O wiring.
- `README.md` — usage docs.

**Live boundary:** the actual `build`/`verify` runs hit nano-gpt and need `NANO_GPT_API_KEY` — those are Chris's manual verification. Everything else is unit-tested with injected fakes.

---

## Task 1: `yaml` dep + ModelFile types & schema

**Files:**
- Modify: `packages/llm-unified/package.json` (add `yaml`)
- Create: `packages/llm-unified/src/curate/model-file.ts`
- Test: `packages/llm-unified/src/curate/model-file.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @chatsundere/llm-unified add yaml`
Expected: `yaml` under `dependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// curate/model-file.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parseModelFile, assembleOfferings } from './model-file.js';

const fileObj = {
  canonical: {
    id: 'glm-6',
    displayName: 'GLM 6',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
  },
  offerings: [
    {
      provider: 'nano-gpt',
      upstreamSlug: 'zai-org/glm-6',
      trust: { tee: false, zdr: false },
      freedomOrientedDeployment: false,
      context: { recommended: 128000, max: 200000 },
    },
  ],
  built: [
    {
      ref: 'nano-gpt:glm-6',
      adapterFile: 'glm-6.nano-gpt.adapter.ts',
      profile: {
        reasoning: { mode: 'toggle', defaultOn: true },
        toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
        vision: false,
        replayReasoning: false,
      },
      confidence: 'verified',
    },
  ],
};

describe('parseModelFile', () => {
  it('accepts a well-formed model file', () => {
    expect(parseModelFile(fileObj).ok).toBe(true);
  });
  it('rejects a file missing canonical.id', () => {
    expect(parseModelFile({ offerings: [] }).ok).toBe(false);
  });
});

describe('assembleOfferings', () => {
  it('merges human offering + built block into a full Offering', () => {
    const parsed = parseModelFile(fileObj);
    if (!parsed.ok) throw new Error('precondition');
    const offerings = assembleOfferings(parsed.file);
    expect(offerings).toHaveLength(1);
    const o = offerings[0]!;
    expect(o.canonicalRef).toBe('glm-6');
    expect(o.providerId).toBe('nano-gpt');
    expect(o.adapter).toEqual({ kind: 'catalogue', adapterId: 'glm-6.nano-gpt.adapter.ts' });
    expect(o.profile.toolCalls.streaming).toBe(false);
    expect(o.source).toBe('curated');
    expect(o.confidence).toBe('verified');
    expect(o.context).toEqual({ recommended: 128000, max: 200000 });
  });

  it('throws when an offering has no matching built entry (not built yet)', () => {
    const noBuild = { ...fileObj, built: [] };
    const parsed = parseModelFile(noBuild);
    if (!parsed.ok) throw new Error('precondition');
    expect(() => assembleOfferings(parsed.file)).toThrow(/not built/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/model-file.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

```ts
// curate/model-file.ts
// SPDX-License-Identifier: LGPL-3.0-only
import * as v from 'valibot';
import type { CanonicalModel, ModelProfile, Offering } from '../catalogue/types.js';

/** A human-authored offering row (the curator fills these). */
export interface HumanOffering {
  provider: string;
  upstreamSlug: string;
  trust: { tee: boolean; zdr: boolean; jurisdiction?: string };
  freedomOrientedDeployment: boolean | null;
  context: { recommended: number; max: number };
}

/** The generated half of one offering, produced by `build`. */
export interface BuiltOffering {
  ref: string; // `${provider}:${canonical.id}`
  adapterFile: string;
  profile: ModelProfile;
  confidence: 'verified' | 'partial' | 'heuristic';
}

/** One model YAML: human-curated identity + offerings, plus the generated build block. */
export interface ModelFile {
  canonical: CanonicalModel;
  offerings: HumanOffering[];
  built?: BuiltOffering[];
}

const ReasoningControlSchema = v.variant('mode', [
  v.object({ mode: v.literal('none') }),
  v.object({ mode: v.literal('fixed-on') }),
  v.object({ mode: v.literal('toggle'), defaultOn: v.boolean() }),
  v.object({
    mode: v.literal('steps'),
    steps: v.array(v.string()),
    offStep: v.nullable(v.string()),
    defaultStep: v.string(),
  }),
]);

const ProfileSchema = v.object({
  reasoning: ReasoningControlSchema,
  toolCalls: v.object({
    supported: v.boolean(),
    streaming: v.boolean(),
    concurrentWithReasoning: v.boolean(),
  }),
  vision: v.boolean(),
  replayReasoning: v.boolean(),
});

const ModelFileSchema = v.object({
  canonical: v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    displayName: v.pipe(v.string(), v.minLength(1)),
    family: v.pipe(v.string(), v.minLength(1)),
    requiredCaps: v.object({ tools: v.boolean(), reasoning: v.boolean(), vision: v.boolean() }),
    freedomOriented: v.nullable(v.boolean()),
    freedomNote: v.optional(v.string()),
    notes: v.optional(v.string()),
  }),
  offerings: v.array(
    v.object({
      provider: v.pipe(v.string(), v.minLength(1)),
      upstreamSlug: v.pipe(v.string(), v.minLength(1)),
      trust: v.object({ tee: v.boolean(), zdr: v.boolean(), jurisdiction: v.optional(v.string()) }),
      freedomOrientedDeployment: v.nullable(v.boolean()),
      context: v.object({ recommended: v.number(), max: v.number() }),
    }),
  ),
  built: v.optional(
    v.array(
      v.object({
        ref: v.string(),
        adapterFile: v.string(),
        profile: ProfileSchema,
        confidence: v.picklist(['verified', 'partial', 'heuristic']),
      }),
    ),
  ),
});

export type ParseResult = { ok: true; file: ModelFile } | { ok: false; errors: string[] };

export function parseModelFile(input: unknown): ParseResult {
  const r = v.safeParse(ModelFileSchema, input);
  if (!r.success) {
    return { ok: false, errors: r.issues.map((i) => i.message) };
  }
  return { ok: true, file: r.output as ModelFile };
}

/** The ref a built entry carries, given a provider and canonical id. */
export function offeringRef(provider: string, canonicalId: string): string {
  return `${provider}:${canonicalId}`;
}

/**
 * Merge each human offering with its matching built entry into a full Offering.
 * Throws if an offering has not been built yet — the caller (build) ensures the
 * built block is complete before assembling for the catalogue.
 */
export function assembleOfferings(file: ModelFile): Offering[] {
  const built = new Map((file.built ?? []).map((b) => [b.ref, b]));
  return file.offerings.map((h) => {
    const ref = offeringRef(h.provider, file.canonical.id);
    const b = built.get(ref);
    if (!b) throw new Error(`offering ${ref} is not built yet (run \`curate model build\`)`);
    return {
      canonicalRef: file.canonical.id,
      providerId: h.provider,
      upstreamSlug: h.upstreamSlug,
      adapter: { kind: 'catalogue', adapterId: b.adapterFile },
      profile: b.profile,
      context: h.context,
      trust: h.trust,
      freedomOrientedDeployment: h.freedomOrientedDeployment,
      source: 'curated',
      confidence: b.confidence,
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/model-file.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** (biome --write first)

```bash
git add packages/llm-unified/package.json packages/llm-unified/src/curate/model-file.ts packages/llm-unified/src/curate/model-file.test.ts
git commit -m "Add model-file schema, parse, and offering assembly for the curation CLI

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Template rendering

**Files:**
- Modify: `packages/llm-unified/src/curate/model-file.ts` (add `renderTemplate`)
- Modify: `packages/llm-unified/src/curate/model-file.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
// append to model-file.test.ts
import { renderTemplate } from './model-file.js';

describe('renderTemplate', () => {
  it('emits a YAML skeleton with mechanical fields filled and judgement fields blank', () => {
    const yaml = renderTemplate({
      canonicalId: 'glm-6',
      displayName: 'GLM 6',
      family: 'glm',
      offerings: [{ provider: 'nano-gpt', upstreamSlug: 'zai-org/glm-6' }],
    });
    expect(yaml).toContain('id: glm-6');
    expect(yaml).toContain('provider: nano-gpt');
    expect(yaml).toContain('upstreamSlug: zai-org/glm-6');
    expect(yaml).toMatch(/freedomOriented:\s*$/m); // blank judgement field
    expect(yaml).toContain('# --- human-curated ---');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/model-file.test.ts`
Expected: FAIL — `renderTemplate` not exported.

- [ ] **Step 3: Implement** (add to `model-file.ts`)

```ts
export interface TemplateArgs {
  canonicalId: string;
  displayName: string;
  family: string;
  offerings: { provider: string; upstreamSlug: string }[];
}

/**
 * Emit a fill-in YAML skeleton. Mechanical fields (ids, slugs) are pre-filled;
 * judgement fields (freedom, trust, context) are left blank for the curator.
 * Hand-built as a string so the blank-field comments and section markers are
 * exactly as a human wants to edit them.
 */
export function renderTemplate(args: TemplateArgs): string {
  const offerings = args.offerings
    .map(
      (o) =>
        `  - provider: ${o.provider}\n` +
        `    upstreamSlug: ${o.upstreamSlug}\n` +
        `    trust: { tee: false, zdr: false }   # ← set per deployment\n` +
        `    freedomOrientedDeployment:           # ← true/false/null (provider-added censorship?)\n` +
        `    context: { recommended: , max: }     # ← where it stays smart / the hard ceiling`,
    )
    .join('\n');

  return `# --- human-curated ---
canonical:
  id: ${args.canonicalId}
  displayName: ${args.displayName}
  family: ${args.family}
  requiredCaps: { tools: true, reasoning: true, vision: false }   # ← the T/R/V identity
  freedomOriented:        # ← true/false/null (NGO guideline judgement)
  freedomNote: ""
offerings:
${offerings}
# build writes the generated 'built:' block below this line — do not edit by hand
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/model-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/curate/model-file.ts packages/llm-unified/src/curate/model-file.test.ts
git commit -m "Add curation template rendering with prefilled mechanical fields

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: Comment-preserving write-back of the `built:` block

**Files:**
- Create: `packages/llm-unified/src/curate/write-back.ts`
- Test: `packages/llm-unified/src/curate/write-back.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// curate/write-back.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { writeBuiltBlock } from './write-back.js';
import type { BuiltOffering } from './model-file.js';

const source = `# --- human-curated ---
canonical:
  id: glm-6        # keep this comment
  displayName: GLM 6
  family: glm
  requiredCaps: { tools: true, reasoning: true, vision: false }
  freedomOriented: true
  freedomNote: ""
offerings:
  - provider: nano-gpt
    upstreamSlug: zai-org/glm-6
    trust: { tee: false, zdr: false }
    freedomOrientedDeployment: false
    context: { recommended: 128000, max: 200000 }
`;

const built: BuiltOffering[] = [
  {
    ref: 'nano-gpt:glm-6',
    adapterFile: 'glm-6.nano-gpt.adapter.ts',
    profile: {
      reasoning: { mode: 'toggle', defaultOn: true },
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: false,
      replayReasoning: false,
    },
    confidence: 'verified',
  },
];

describe('writeBuiltBlock', () => {
  it('adds the built block while preserving human content and comments', () => {
    const out = writeBuiltBlock(source, built);
    expect(out).toContain('keep this comment'); // human comment survived
    const parsed = parseYaml(out) as { canonical: { id: string }; built: BuiltOffering[] };
    expect(parsed.canonical.id).toBe('glm-6');
    expect(parsed.built).toHaveLength(1);
    expect(parsed.built[0]?.adapterFile).toBe('glm-6.nano-gpt.adapter.ts');
  });

  it('replaces a previous built block on re-run (idempotent)', () => {
    const once = writeBuiltBlock(source, built);
    const twice = writeBuiltBlock(once, built);
    const parsed = parseYaml(twice) as { built: BuiltOffering[] };
    expect(parsed.built).toHaveLength(1); // not duplicated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/write-back.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (using the `yaml` Document API to preserve comments)

```ts
// curate/write-back.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { parseDocument } from 'yaml';
import type { BuiltOffering } from './model-file.js';

/**
 * Set the `built:` key on a model YAML, preserving all human comments and
 * formatting elsewhere. Re-running replaces the prior `built` value (idempotent)
 * rather than appending. Uses the `yaml` Document API so the human-curated half
 * above is untouched.
 */
export function writeBuiltBlock(source: string, built: BuiltOffering[]): string {
  const doc = parseDocument(source);
  // `built` is machine-owned: replace wholesale. JSON round-trip strips any class
  // wrappers so the values serialise as plain YAML.
  doc.set('built', JSON.parse(JSON.stringify(built)));
  return doc.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/write-back.test.ts`
Expected: PASS (comment preserved, no duplication on re-run).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/curate/write-back.ts packages/llm-unified/src/curate/write-back.test.ts
git commit -m "Add comment-preserving write-back of the generated built block

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: Provider scanner (interface + nano-gpt slug zoo)

**Files:**
- Create: `packages/llm-unified/src/curate/provider-scanner.ts`
- Test: `packages/llm-unified/src/curate/provider-scanner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// curate/provider-scanner.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { groupNanoGptSlugs } from './provider-scanner.js';

describe('groupNanoGptSlugs', () => {
  it('groups bare + :thinking into one offering, and TEE into its own', () => {
    const groups = groupNanoGptSlugs([
      'zai-org/glm-6',
      'zai-org/glm-6:thinking',
      'TEE/glm-6',
      'TEE/glm-6-thinking',
      'deepseek/deepseek-v4-pro',
    ]);
    // glm-6 bare offering carries its reasoning variant; TEE is a separate offering
    const glm = groups.find((g) => g.baseSlug === 'zai-org/glm-6' && !g.teeVariant);
    expect(glm?.reasoningVariant).toBe('zai-org/glm-6:thinking');
    const tee = groups.find((g) => g.teeVariant);
    expect(tee?.baseSlug).toBe('TEE/glm-6');
    expect(tee?.reasoningVariant).toBe('TEE/glm-6-thinking');
    // deepseek with no thinking sibling still produces an offering
    expect(groups.some((g) => g.baseSlug === 'deepseek/deepseek-v4-pro')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/provider-scanner.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// curate/provider-scanner.ts
// SPDX-License-Identifier: LGPL-3.0-only

/** One logical offering discovered upstream: a base slug plus any variants. */
export interface DiscoveredOffering {
  providerId: string;
  baseSlug: string;
  /** The slug that turns reasoning on (':thinking' for normal, '-thinking' for TEE), if any. */
  reasoningVariant?: string;
  /** True when this is a TEE deployment (base slug under the `TEE/` prefix). */
  teeVariant?: boolean;
}

export interface ProviderScanner {
  providerId: string;
  /** Fetch the upstream model list and group it into logical offerings. */
  listOfferings(): Promise<DiscoveredOffering[]>;
}

/**
 * Group nano-gpt's raw slug list into logical offerings, taming the nano-gptism
 * zoo: a model has a bare slug and an optional `:thinking` reasoning sibling;
 * TEE deployments live under a `TEE/` prefix and use `-thinking` (hyphen, not
 * colon) for their reasoning sibling. Bare and TEE are SEPARATE offerings.
 */
export function groupNanoGptSlugs(slugs: string[]): DiscoveredOffering[] {
  const set = new Set(slugs);
  const out: DiscoveredOffering[] = [];
  for (const slug of slugs) {
    const isTee = slug.startsWith('TEE/');
    // Skip reasoning siblings — they attach to their base, not stand alone.
    if (!isTee && slug.endsWith(':thinking')) continue;
    if (isTee && slug.endsWith('-thinking')) continue;
    if (isTee) {
      const thinking = `${slug}-thinking`;
      out.push({
        providerId: 'nano-gpt',
        baseSlug: slug,
        teeVariant: true,
        ...(set.has(thinking) ? { reasoningVariant: thinking } : {}),
      });
    } else {
      const thinking = `${slug}:thinking`;
      out.push({
        providerId: 'nano-gpt',
        baseSlug: slug,
        ...(set.has(thinking) ? { reasoningVariant: thinking } : {}),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/provider-scanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/curate/provider-scanner.ts packages/llm-unified/src/curate/provider-scanner.test.ts
git commit -m "Add provider scanner with nano-gpt slug-zoo grouping

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: Deterministic model report

**Files:**
- Create: `packages/llm-unified/src/curate/report.ts`
- Test: `packages/llm-unified/src/curate/report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// curate/report.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { CanonicalModel, Offering } from '../catalogue/types.js';
import { renderReport } from './report.js';

const canonical: CanonicalModel = {
  id: 'glm-6',
  displayName: 'GLM 6',
  family: 'glm',
  requiredCaps: { tools: true, reasoning: true, vision: false },
  freedomOriented: true,
};

const offerings: Offering[] = [
  {
    canonicalRef: 'glm-6',
    providerId: 'nano-gpt',
    upstreamSlug: 'zai-org/glm-6',
    adapter: { kind: 'catalogue', adapterId: 'glm-6.nano-gpt.adapter.ts' },
    profile: {
      reasoning: { mode: 'toggle', defaultOn: true },
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 128000, max: 200000 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: false, // → restricted via deployment
    source: 'curated',
    confidence: 'verified',
  },
];

describe('renderReport', () => {
  it('renders identity, offerings, badges and freedom honestly', () => {
    const md = renderReport(canonical, offerings);
    expect(md).toContain('# GLM 6');
    expect(md).toContain('nano-gpt');
    expect(md).toContain('128000'); // recommended
    expect(md).toContain('200000'); // max
    expect(md).toContain('block'); // tool-call streaming:false rendered as "block"
    expect(md).toMatch(/freedom.*restricted/i); // model free but deployment not → restricted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/report.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// curate/report.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { CanonicalModel, Offering, ReasoningControl } from '../catalogue/types.js';
import { effectiveFreedom } from '../catalogue/freedom.js';

function caps(c: CanonicalModel['requiredCaps']): string {
  return [c.tools && 'tools', c.reasoning && 'reasoning', c.vision && 'vision']
    .filter(Boolean)
    .join(', ');
}

function reasoningSummary(r: ReasoningControl): string {
  switch (r.mode) {
    case 'none':
      return 'none';
    case 'fixed-on':
      return 'always on';
    case 'toggle':
      return 'on/off toggle';
    case 'steps':
      return `steps (${r.steps.join('/')})`;
  }
}

/** Deterministic Markdown report for one curated model. No LLM — pure render. */
export function renderReport(canonical: CanonicalModel, offerings: Offering[]): string {
  const lines: string[] = [];
  lines.push(`# ${canonical.displayName}`);
  lines.push('');
  lines.push(`- **Canonical id:** \`${canonical.id}\``);
  lines.push(`- **Family:** ${canonical.family}`);
  lines.push(`- **Capabilities:** ${caps(canonical.requiredCaps)}`);
  lines.push(
    `- **Model freedom:** ${canonical.freedomOriented === null ? 'unassessed' : canonical.freedomOriented ? 'free' : 'restricted'}` +
      (canonical.freedomNote ? ` — ${canonical.freedomNote}` : ''),
  );
  lines.push('');
  lines.push('## Offerings');
  lines.push('');
  for (const o of offerings) {
    const freedom = effectiveFreedom(canonical.freedomOriented, o.freedomOrientedDeployment);
    const privacy = o.trust.tee || o.trust.zdr ? `🔒 ${[o.trust.tee && 'TEE', o.trust.zdr && 'ZDR'].filter(Boolean).join('+')}` : '—';
    lines.push(`### ${o.providerId} · \`${o.upstreamSlug}\``);
    lines.push(`- Tool calls: ${o.profile.toolCalls.supported ? (o.profile.toolCalls.streaming ? 'streamed' : 'block') : 'unsupported'}`);
    lines.push(`- Reasoning: ${reasoningSummary(o.profile.reasoning)}`);
    lines.push(`- Context: ${o.context.recommended} recommended / ${o.context.max} max`);
    lines.push(`- Privacy: ${privacy}`);
    lines.push(`- 🕊️ Freedom: ${freedom}`);
    lines.push(`- Confidence: ${o.confidence}`);
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/curate/report.ts packages/llm-unified/src/curate/report.test.ts
git commit -m "Add deterministic model-report renderer

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Build orchestration (dependency-injected)

Drives the synthesis loop per human offering, returning `BuiltOffering[]`. The synthesis primitives (capture, analyzer, sandbox, validate, loop) are injected so this is unit-testable without the network.

**Files:**
- Create: `packages/llm-unified/src/curate/build.ts`
- Test: `packages/llm-unified/src/curate/build.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// curate/build.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { buildOffering } from './build.js';
import type { HumanOffering } from './model-file.js';

const human: HumanOffering = {
  provider: 'nano-gpt',
  upstreamSlug: 'zai-org/glm-6',
  trust: { tee: false, zdr: false },
  freedomOrientedDeployment: false,
  context: { recommended: 128000, max: 200000 },
};

const profile = {
  reasoning: { mode: 'toggle', defaultOn: true } as const,
  toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
  vision: false,
  replayReasoning: false,
};

describe('buildOffering', () => {
  it('runs the loop and returns a verified built entry + adapter source on success', async () => {
    const result = await buildOffering({
      human,
      canonicalId: 'glm-6',
      runLoop: async () => ({ outcome: 'verified', adapterSource: 'export const adapter = {};', profile }),
    });
    expect(result.built.ref).toBe('nano-gpt:glm-6');
    expect(result.built.confidence).toBe('verified');
    expect(result.built.adapterFile).toBe('glm-6.nano-gpt.adapter.ts');
    expect(result.adapterSource).toContain('adapter');
    expect(result.built.profile.toolCalls.streaming).toBe(false);
  });

  it('marks heuristic confidence on fallback', async () => {
    const result = await buildOffering({
      human,
      canonicalId: 'glm-6',
      runLoop: async () => ({ outcome: 'heuristic-fallback', adapterSource: null, profile }),
    });
    expect(result.built.confidence).toBe('heuristic');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/build.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// curate/build.ts
// SPDX-License-Identifier: LGPL-3.0-only
import type { ModelProfile } from '../catalogue/types.js';
import type { BuiltOffering, HumanOffering } from './model-file.js';
import { offeringRef } from './model-file.js';

/** Outcome of synthesising one offering's adapter (the injected loop returns this). */
export interface LoopOutcome {
  outcome: 'verified' | 'heuristic-fallback';
  adapterSource: string | null;
  profile: ModelProfile;
}

export interface BuildOfferingArgs {
  human: HumanOffering;
  canonicalId: string;
  /** Injected: probe → generate → validate → self-repair for this offering. */
  runLoop: (human: HumanOffering) => Promise<LoopOutcome>;
}

export interface BuildOfferingResult {
  built: BuiltOffering;
  /** The generated adapter source to write to disk, or null on fallback. */
  adapterSource: string | null;
}

/** The adapter filename for an offering: `<canonicalId>.<provider>.adapter.ts`. */
export function adapterFileName(canonicalId: string, provider: string): string {
  return `${canonicalId}.${provider}.adapter.ts`;
}

/**
 * Build one offering: run the (injected) synthesis loop, then shape the result
 * into a BuiltOffering. Confidence reflects the loop outcome — verified when the
 * generated adapter reproduced the evidence, heuristic on fallback.
 */
export async function buildOffering(args: BuildOfferingArgs): Promise<BuildOfferingResult> {
  const outcome = await args.runLoop(args.human);
  const adapterFile = adapterFileName(args.canonicalId, args.human.provider);
  return {
    built: {
      ref: offeringRef(args.human.provider, args.canonicalId),
      adapterFile,
      profile: outcome.profile,
      confidence: outcome.outcome === 'verified' ? 'verified' : 'heuristic',
    },
    adapterSource: outcome.adapterSource,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/curate/build.ts packages/llm-unified/src/curate/build.test.ts
git commit -m "Add build orchestration shaping loop outcomes into built offerings

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: CLI argv dispatch + help

**Files:**
- Create: `packages/llm-unified/src/curate/cli-dispatch.ts`
- Test: `packages/llm-unified/src/curate/cli-dispatch.test.ts`

The pure argv→intent parser is unit-tested; the live entry (Task 8) wires it to I/O.

- [ ] **Step 1: Write the failing test**

```ts
// curate/cli-dispatch.test.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parseArgs } from './cli-dispatch.js';

describe('parseArgs', () => {
  it('parses provider list', () => {
    expect(parseArgs(['provider', 'list'])).toEqual({ kind: 'provider-list' });
  });
  it('parses model template with refs', () => {
    expect(parseArgs(['model', 'template', 'nano-gpt:zai-org/glm-6'])).toEqual({
      kind: 'model-template',
      refs: ['nano-gpt:zai-org/glm-6'],
    });
  });
  it('parses model build with --verify', () => {
    expect(parseArgs(['model', 'build', 'models/glm-6.yaml', '--verify'])).toEqual({
      kind: 'model-build',
      file: 'models/glm-6.yaml',
      verify: true,
    });
  });
  it('parses model verify --all', () => {
    expect(parseArgs(['model', 'verify', '--all'])).toEqual({ kind: 'model-verify', all: true, ref: null });
  });
  it('returns help for empty or --help', () => {
    expect(parseArgs([]).kind).toBe('help');
    expect(parseArgs(['--help']).kind).toBe('help');
  });
  it('returns help for an unknown command', () => {
    expect(parseArgs(['frobnicate']).kind).toBe('help');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/curate/cli-dispatch.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// curate/cli-dispatch.ts
// SPDX-License-Identifier: LGPL-3.0-only

export type Intent =
  | { kind: 'help' }
  | { kind: 'provider-list' }
  | { kind: 'model-list'; provider: string | null }
  | { kind: 'model-template'; refs: string[] }
  | { kind: 'model-build'; file: string; verify: boolean }
  | { kind: 'model-report'; ref: string }
  | { kind: 'model-verify'; ref: string | null; all: boolean };

/** Pure argv → intent. The live entry maps intents to I/O. */
export function parseArgs(argv: string[]): Intent {
  const [group, sub, ...rest] = argv;
  if (!group || group === '--help' || group === 'help') return { kind: 'help' };

  if (group === 'provider' && sub === 'list') return { kind: 'provider-list' };

  if (group === 'model') {
    const positional = rest.filter((a) => !a.startsWith('--'));
    const flags = new Set(rest.filter((a) => a.startsWith('--')));
    if (sub === 'list') return { kind: 'model-list', provider: positional[0] ?? null };
    if (sub === 'template' && positional.length > 0) return { kind: 'model-template', refs: positional };
    if (sub === 'build' && positional[0])
      return { kind: 'model-build', file: positional[0], verify: flags.has('--verify') };
    if (sub === 'report' && positional[0]) return { kind: 'model-report', ref: positional[0] };
    if (sub === 'verify')
      return { kind: 'model-verify', ref: positional[0] ?? null, all: flags.has('--all') };
  }

  return { kind: 'help' };
}

export const HELP_TEXT = `curate — Chatsundere model-support factory

  curate provider list
  curate model list [provider]
  curate model template <provider:slug>...   > model.yaml
  curate model build <file.yaml> [--verify]
  curate model report <ref>
  curate model verify <ref> | --all
`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/llm-unified && bun test src/curate/cli-dispatch.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add packages/llm-unified/src/curate/cli-dispatch.ts packages/llm-unified/src/curate/cli-dispatch.test.ts
git commit -m "Add curation CLI argv dispatch and help text

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Live CLI entry + README + manual verification

Wire the intents to real I/O: filesystem (model files, adapter files, reports), the `ProviderScanner` (live `/models`), and the synthesis loop. No unit test — covered by manual verification (needs `NANO_GPT_API_KEY`).

**Files:**
- Create: `packages/llm-unified/src/curate/cli.ts`
- Create: `packages/llm-unified/src/curate/README.md`
- Modify: `packages/llm-unified/package.json` (add `"curate"` script)

- [ ] **Step 1: Implement the live entry** (`cli.ts`)

```ts
// curate/cli.ts
// SPDX-License-Identifier: LGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { getProvider } from '../registry.js';
import { runOneShotCompletion } from '../one-shot-completion.js';
import { streamCompletion } from '../stream-completion.js';
import { buildAnalyzerPrompt, extractAdapterModule } from '../synthesis/analyzer.js';
import { runProbe } from '../synthesis/capture.js';
import { deriveObservedProfile } from '../synthesis/derive-profile.js';
import { runSynthesisLoop } from '../synthesis/loop.js';
import { buildProbeSuite } from '../synthesis/probe-suite.js';
import { loadAdapterInSandbox } from '../synthesis/sandbox-host.js';
import { validateAdapter } from '../synthesis/validate.js';
import { adapterFileName, buildOffering } from './build.js';
import { type Intent, HELP_TEXT, parseArgs } from './cli-dispatch.js';
import { assembleOfferings, parseModelFile, renderTemplate } from './model-file.js';
import { groupNanoGptSlugs } from './provider-scanner.js';
import { renderReport } from './report.js';
import { writeBuiltBlock } from './write-back.js';

const BASE_URL = 'https://nano-gpt.com/api/v1';

async function main(): Promise<void> {
  const intent = parseArgs(process.argv.slice(2));
  registerBuiltinProviders();

  switch (intent.kind) {
    case 'help':
      console.log(HELP_TEXT);
      return;
    case 'provider-list': {
      // list registered providers by id
      for (const id of ['nano-gpt', 'novita', 'ollama-cloud']) {
        console.log(getProvider(id) ? `  ${id}` : `  ${id} (not registered)`);
      }
      return;
    }
    case 'model-template': {
      // refs like 'nano-gpt:zai-org/glm-6'
      const offerings = intent.refs.map((r) => {
        const [provider, ...slugParts] = r.split(':');
        return { provider: provider ?? '', upstreamSlug: slugParts.join(':') };
      });
      const first = offerings[0]?.upstreamSlug ?? 'model';
      const canonicalId = first.split('/').pop() ?? 'model';
      process.stdout.write(
        renderTemplate({ canonicalId, displayName: canonicalId, family: canonicalId.split('-')[0] ?? canonicalId, offerings }),
      );
      return;
    }
    case 'model-build':
      await runBuild(intent);
      return;
    default:
      console.log(HELP_TEXT);
  }
}

async function runBuild(intent: Extract<Intent, { kind: 'model-build' }>): Promise<void> {
  const apiKey = process.env.NANO_GPT_API_KEY;
  if (!apiKey) throw new Error('NANO_GPT_API_KEY is not set');
  const filePath = resolve(intent.file);
  const source = await readFile(filePath, 'utf8');
  const parsed = parseModelFile(parseYaml(source));
  if (!parsed.ok) throw new Error(`invalid model file:\n${parsed.errors.join('\n')}`);
  const file = parsed.file;

  const builtEntries = [];
  for (const human of file.offerings) {
    console.log(`\nBuilding ${human.provider}:${file.canonical.id} (${human.upstreamSlug})...`);
    const slug = human.upstreamSlug;
    const result = await buildOffering({
      human,
      canonicalId: file.canonical.id,
      runLoop: (h) => synthesiseAdapter(h, slug, apiKey),
    });
    console.log(`  ${result.built.confidence}`);
    // write the adapter sibling next to the model file
    if (result.adapterSource) {
      await writeFile(join(dirname(filePath), result.built.adapterFile), result.adapterSource);
    }
    builtEntries.push(result.built);
  }

  // write the built block back into the YAML (comment-preserving)
  await writeFile(filePath, writeBuiltBlock(source, builtEntries));

  // assemble + report
  const offerings = assembleOfferings({ ...file, built: builtEntries });
  const reportDir = resolve(import.meta.dir, '..', '..', '..', '..', 'obsidian', 'models');
  await writeFile(join(reportDir, `${file.canonical.id}.md`), renderReport(file.canonical, offerings)).catch(
    (e) => console.warn(`  (report not written: ${(e as Error).message})`),
  );
  console.log(`\nDone. Report: obsidian/models/${file.canonical.id}.md`);
}

// Live synthesis for one offering — reuses the spike engine. Returns LoopOutcome.
async function synthesiseAdapter(
  human: { provider: string; upstreamSlug: string },
  slug: string,
  apiKey: string,
): ReturnType<typeof import('./build.js').buildOffering> extends Promise<infer _> ? never : never;
```

> **NOTE TO IMPLEMENTER:** `cli.ts` is the live wiring. The `synthesiseAdapter` helper must build the probe suite for the offering's slug pair, capture fixtures via `runProbe`, run `runSynthesisLoop` (analyzer via `streamCompletion` as in `synthesis/cli.ts`, validation via `loadAdapterInSandbox` + `validateAdapter` + `deriveObservedProfile`), and map the result to `{ outcome, adapterSource, profile }`. Model this closely on the existing `src/synthesis/cli.ts` (which already does capture → generate → validate with self-repair). Derive the `ModelProfile` for the `built` entry from `deriveObservedProfile` mapped into a `ReasoningControl` (`always_on`→`fixed-on`, `optional`→`toggle`, `no_reasoning`→`none`) plus the observed tool-call facts. Keep `cli.ts` focused on wiring; if it grows past ~150 lines, extract the synthesis wiring into `curate/synthesise.ts`. This file is NOT unit-tested — it is covered by the manual verification below. Replace the stub `synthesiseAdapter` signature above with the real implementation.

- [ ] **Step 2: Add the README** (`curate/README.md`)

```markdown
# curate — model-support factory

Maintainer CLI. Not shipped to clients.

## Commands
- `bun run curate provider list`
- `bun run curate model list [provider]`
- `bun run curate model template <provider:slug>... > models/<id>.yaml`
- `bun run curate model build models/<id>.yaml [--verify]`
- `bun run curate model report <ref>`
- `bun run curate model verify <ref> | --all`

## Flow
1. `model template …` → fill the judgement fields (freedom, trust, context).
2. `model build …` → synthesises + validates a per-offering adapter, writes the
   `built:` block back into the YAML and the adapter as a sibling `.ts`, and
   renders `obsidian/models/<id>.md`.
3. Review the generated adapter `.ts`; test in the app; commit.

Requires `NANO_GPT_API_KEY` (see `.env.example`).
```

- [ ] **Step 3: Add the script** to `packages/llm-unified/package.json`

```json
    "curate": "bun run src/curate/cli.ts"
```
(after the `"synthesise"` line, valid JSON).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chatsundere/llm-unified typecheck`
Expected: clean (fix any wiring type errors; the `synthesiseAdapter` stub MUST be replaced with a real implementation that type-checks).

- [ ] **Step 5: Smoke (no network)**

Run: `cd packages/llm-unified && env -u NANO_GPT_API_KEY bun run curate --help` and `... model template nano-gpt:zai-org/glm-6`
Expected: help text prints; template prints a YAML skeleton with blank judgement fields.

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/curate/cli.ts packages/llm-unified/src/curate/README.md packages/llm-unified/package.json
git commit -m "Wire the curation CLI live entry, scripts and docs

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] **Step 7: Manual verification (Chris, needs key)**

With `NANO_GPT_API_KEY` set and a filled `models/glm-6.yaml` (real model):
`cd packages/llm-unified && bun run curate model build models/<id>.yaml --verify`
Expected: per-offering build verdicts, adapter `.ts` siblings written, `built:` block added to the YAML with human comments intact, and `obsidian/models/<id>.md` rendered with correct badges/freedom.

---

## Self-Review

**Spec coverage:**
- Command surface (provider list / model list / template / build / report / verify) → Tasks 7 (dispatch) + 8 (wiring). ✓
- Model YAML schema (human + built) → Task 1. ✓
- Template prefill → Task 2. ✓
- Comment-preserving write-back → Task 3. ✓
- Per-provider scanner / nano-gpt slug zoo → Task 4. ✓
- Deterministic report → Task 5. ✓
- build drives synthesis → Tasks 6 (shape) + 8 (live wiring). ✓
- Reuses synthesis engine + catalogue types → Tasks 6, 8. ✓
- Deferred (correctly absent): signing/feed, Ollama catch-all, phase-2 helpers, `model list` rich diff (basic listing only in Task 8).

**Placeholder scan:** One deliberate implementer NOTE in Task 8 (the live `synthesiseAdapter` wiring) — flagged explicitly as the non-unit-tested live boundary to be modelled on the existing `src/synthesis/cli.ts`, with concrete instructions. All unit-testable tasks (1–7) have complete code.

**Type consistency:** `HumanOffering`/`BuiltOffering`/`ModelFile` (Task 1) used by `build.ts` (Task 6), `write-back.ts` (Task 3), `cli.ts` (Task 8); `offeringRef`/`adapterFileName` defined once and reused; `Intent` (Task 7) consumed in Task 8; `DiscoveredOffering` (Task 4) consumed by the live `model list`. `Offering`/`CanonicalModel`/`ReasoningControl` come from the committed `catalogue/` layer.

**Note for executor:** `model list` and `model verify` live handlers are thin and live-only — implement them in Task 8's `cli.ts` alongside `provider-list`/`template`/`build` following the same pattern (list = scanner.listOfferings printed; verify = re-probe one/all built offerings). They have no unit test (live I/O); keep them minimal.
