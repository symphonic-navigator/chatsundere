// SPDX-License-Identifier: LGPL-3.0-only
import * as v from 'valibot';
import type { CanonicalModel, ModelProfile, Offering } from '../../catalogue/types.js';

export interface HumanOffering {
  provider: string;
  upstreamSlug: string;
  trust: { tee: boolean; zdr: boolean; jurisdiction?: string };
  freedomOrientedDeployment: boolean | null;
  context: { recommended: number; max: number };
}

export interface BuiltOffering {
  ref: string;
  adapterFile: string;
  profile: ModelProfile;
  confidence: 'verified' | 'partial' | 'heuristic';
}

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
  if (!r.success) return { ok: false, errors: r.issues.map((i) => i.message) };
  return { ok: true, file: r.output as ModelFile };
}

export function offeringRef(provider: string, canonicalId: string): string {
  return `${provider}:${canonicalId}`;
}

export function assembleOfferings(file: ModelFile): Offering[] {
  const built = new Map((file.built ?? []).map((b) => [b.ref, b]));
  return file.offerings.map((h) => {
    const ref = offeringRef(h.provider, file.canonical.id);
    const b = built.get(ref);
    if (!b) throw new Error(`offering ${ref} is not built yet (build it via the /curate skill)`);
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
      serviceKind: 'llm',
    };
  });
}

export interface TemplateArgs {
  canonicalId: string;
  displayName: string;
  family: string;
  offerings: { provider: string; upstreamSlug: string }[];
}

export function renderTemplate(args: TemplateArgs): string {
  const offerings = args.offerings
    .map(
      (o) =>
        `  - provider: ${o.provider}\n    upstreamSlug: ${o.upstreamSlug}\n    trust: { tee: false, zdr: false }   # ← set per deployment\n    freedomOrientedDeployment:           # ← true/false/null (provider-added censorship?)\n    context: { recommended: , max: }     # ← where it stays smart / the hard ceiling`,
    )
    .join('\n');

  return `# --- human-curated ---
canonical:
  id: ${args.canonicalId}
  displayName: ${args.displayName}
  family: ${args.family}
  requiredCaps: { tools: true, reasoning: true, vision: false }   # ← the T/R/V identity
  freedomOriented:
  freedomNote: ""
offerings:
${offerings}
# build writes the generated 'built:' block below this line — do not edit by hand
`;
}
