// SPDX-License-Identifier: LGPL-3.0-only
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalModel, ModelProfile, ReasoningControl } from '../catalogue/types.js';
import { streamCompletion } from '../stream-completion.js';
import { buildAnalyzerPrompt, extractAdapterModule } from '../synthesis/analyzer.js';
import { runProbe } from '../synthesis/capture.js';
import { type ObservedFacts, deriveObservedProfile } from '../synthesis/derive-profile.js';
import type { CapturedFixture } from '../synthesis/fixture-types.js';
import { runSynthesisLoop } from '../synthesis/loop.js';
import { buildProbeSuite } from '../synthesis/probe-suite.js';
import { loadAdapterInSandbox } from '../synthesis/sandbox-host.js';
import { validateAgainstFixtures } from '../synthesis/validate-fixtures.js';
import type { KnownModel, ProviderDefinition } from '../types.js';
import type { LoopOutcome } from './build.js';
import type { HumanOffering } from './model-file.js';

const MAX_ROUNDS = 3;

function reasoningControlFrom(kind: ObservedFacts['reasoningKind']): ReasoningControl {
  switch (kind) {
    case 'no_reasoning':
      return { mode: 'none' };
    case 'always_on':
      return { mode: 'fixed-on' };
    case 'optional':
      return { mode: 'toggle', defaultOn: true };
  }
}

/**
 * Derive the offering's profile from the EMPIRICAL observed facts, not from the
 * analyzer's claimed profile. Probe-derivable fields (reasoning kind, tool-call
 * streaming/concurrency) come from the evidence; `vision` is the curator's
 * requiredCaps assertion and `replayReasoning` defaults to soft-CoT — neither is
 * probe-derivable.
 */
function profileFromObserved(o: ObservedFacts, visionRequired: boolean): ModelProfile {
  return {
    reasoning: reasoningControlFrom(o.reasoningKind),
    toolCalls: {
      supported: o.toolCallsSupported,
      streaming: o.toolCallsStreaming,
      concurrentWithReasoning: o.concurrentWithReasoning,
    },
    vision: visionRequired,
    replayReasoning: false,
  };
}

/** nano-gpt's reasoning-variant slug convention (`:thinking`, or `-thinking` under TEE/). */
function thinkingSlug(bare: string): string {
  return bare.startsWith('TEE/') ? `${bare}-thinking` : `${bare}:thinking`;
}

export interface SynthesiseArgs {
  human: HumanOffering;
  canonical: CanonicalModel;
  apiKey: string;
  /** The adapter-contract source, embedded in the analyzer prompt. */
  contract: string;
  /** The target provider (for its base URL). */
  provider: ProviderDefinition;
  /** The trusted writer provider (nano-gpt) and model (GLM-5.1). */
  analyzerProvider: ProviderDefinition;
  analyzerModel: KnownModel;
}

/**
 * Synthesise one offering's adapter live: probe the target → capture fixtures →
 * GLM writes the adapter → validate it structurally against the fixtures (no
 * baseline) with self-repair. Returns the LoopOutcome `build` shapes into a
 * BuiltOffering. The profile is derived from the observed facts, not the
 * analyzer's claim.
 */
export async function synthesiseOffering(args: SynthesiseArgs): Promise<LoopOutcome> {
  const bare = args.human.upstreamSlug;
  const probes = buildProbeSuite({ thinkingSlug: thinkingSlug(bare), bareSlug: bare });

  const fixtures: CapturedFixture[] = [];
  for (const probe of probes) {
    const fx = await runProbe({ baseUrl: args.provider.baseUrl, apiKey: args.apiKey, probe });
    console.log(`    ${probe.dimension}: HTTP ${fx.status} (${fx.rawResponse.length} bytes)`);
    fixtures.push(fx);
  }
  const observed = deriveObservedProfile(fixtures);

  const workDir = await mkdtemp(join(tmpdir(), 'curate-'));
  let attempt = 0;

  const result = await runSynthesisLoop({
    maxRounds: MAX_ROUNDS,
    generate: async (priorFailures) => {
      attempt += 1;
      console.log(`    round ${attempt}: ${args.analyzerModel.id} writing the adapter...`);
      const prompt = buildAnalyzerPrompt({
        contract: args.contract,
        providerDocs: `${args.provider.id} is OpenAI chat-completions compatible at /chat/completions.`,
        fixtures,
        priorFailures,
      });
      let reply = '';
      for await (const chunk of streamCompletion({
        provider: args.analyzerProvider,
        providerConfig: { baseUrl: args.analyzerProvider.baseUrl, routing: { kind: 'direct' } },
        apiKey: args.apiKey,
        corsProxyUrl: null,
        corsProxyKey: null,
        model: args.analyzerModel,
        messages: [{ role: 'user', content: prompt }],
        bodyExtras: { reasoning: { enabled: true } },
        initialResponseTimeoutMs: 120_000,
      })) {
        if (chunk.type === 'token') {
          reply += chunk.text;
          process.stdout.write('.');
        } else if (chunk.type === 'error') {
          console.warn(`\n    (stream error: ${chunk.message})`);
        }
      }
      process.stdout.write('\n');
      return extractAdapterModule(reply);
    },
    validate: async (source) => {
      const modPath = join(workDir, `candidate-${attempt}.ts`);
      await writeFile(modPath, source);
      let candidate: Awaited<ReturnType<typeof loadAdapterInSandbox>>;
      try {
        candidate = await loadAdapterInSandbox(modPath);
      } catch (e) {
        return { passed: false, failures: [`adapter failed to load: ${(e as Error).message}`] };
      }
      try {
        return await validateAgainstFixtures({ candidate, fixtures });
      } finally {
        candidate.dispose();
      }
    },
  });

  return {
    outcome: result.outcome === 'verified' ? 'verified' : 'heuristic-fallback',
    adapterSource: result.adapterSource,
    profile: profileFromObserved(observed, args.canonical.requiredCaps.vision),
  };
}
