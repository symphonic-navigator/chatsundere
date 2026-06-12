// SPDX-License-Identifier: LGPL-3.0-only
import * as v from 'valibot';
import type { CanonicalModel, Offering } from './types.js';

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

const ModelProfileSchema = v.object({
  reasoning: ReasoningControlSchema,
  toolCalls: v.object({
    supported: v.boolean(),
    streaming: v.boolean(),
    concurrentWithReasoning: v.boolean(),
  }),
  vision: v.boolean(),
  replayReasoning: v.boolean(),
});

const CanonicalSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  displayName: v.pipe(v.string(), v.minLength(1)),
  family: v.pipe(v.string(), v.minLength(1)),
  requiredCaps: v.object({ tools: v.boolean(), reasoning: v.boolean(), vision: v.boolean() }),
  freedomOriented: v.nullable(v.boolean()),
  freedomNote: v.optional(v.string()),
  modelInstructions: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const AdapterRefSchema = v.variant('kind', [
  v.object({ kind: v.literal('catalogue'), adapterId: v.string() }),
  v.object({ kind: v.literal('generic') }),
]);

const OfferingSchema = v.object({
  canonicalRef: v.nullable(v.string()),
  providerId: v.pipe(v.string(), v.minLength(1)),
  upstreamSlug: v.pipe(v.string(), v.minLength(1)),
  adapter: AdapterRefSchema,
  profile: ModelProfileSchema,
  context: v.object({ recommended: v.number(), max: v.number() }),
  trust: v.object({ tee: v.boolean(), zdr: v.boolean(), jurisdiction: v.optional(v.string()) }),
  freedomOrientedDeployment: v.nullable(v.boolean()),
  source: v.picklist(['curated', 'discovered']),
  confidence: v.picklist(['verified', 'partial', 'heuristic']),
  // Modality defaults to 'llm' when absent, so external/discovered catalogue
  // entries predating ServiceKind remain valid.
  serviceKind: v.optional(v.picklist(['llm', 'web', 'tts', 'stt', 'tti']), 'llm'),
});

const EntrySchema = v.object({ canonical: CanonicalSchema, offerings: v.array(OfferingSchema) });

export interface CatalogueEntry {
  canonical: CanonicalModel;
  offerings: Offering[];
}

export type ParseResult = { ok: true; entry: CatalogueEntry } | { ok: false; errors: string[] };

/** The capability gate: every offering must deliver the canonical's requiredCaps. */
function capabilityGateErrors(entry: CatalogueEntry): string[] {
  const req = entry.canonical.requiredCaps;
  const errs: string[] = [];
  for (const o of entry.offerings) {
    const where = `${o.providerId}:${o.upstreamSlug}`;
    if (req.tools && !o.profile.toolCalls.supported)
      errs.push(`capability gate: offering ${where} lacks required tools`);
    if (req.vision && !o.profile.vision)
      errs.push(`capability gate: offering ${where} lacks required vision`);
    if (req.reasoning && o.profile.reasoning.mode === 'none')
      errs.push(`capability gate: offering ${where} lacks required reasoning`);
  }
  return errs;
}

/** Validate structure (Valibot) then enforce the capability gate. */
export function parseCatalogueEntry(input: unknown): ParseResult {
  const result = v.safeParse(EntrySchema, input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.issues.map(
        (i) => `${i.path?.map((p) => String(p.key)).join('.') ?? ''}: ${i.message}`,
      ),
    };
  }
  const entry: CatalogueEntry = result.output;
  const gateErrors = capabilityGateErrors(entry);
  if (gateErrors.length > 0) return { ok: false, errors: gateErrors };
  return { ok: true, entry };
}
