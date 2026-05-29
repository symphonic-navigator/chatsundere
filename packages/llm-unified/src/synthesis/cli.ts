// SPDX-License-Identifier: LGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { getProvider } from '../registry.js';
import { streamCompletion } from '../stream-completion.js';
import { buildAnalyzerPrompt, extractAdapterModule } from './analyzer.js';
import { runProbe } from './capture.js';
import { deriveObservedProfile } from './derive-profile.js';
import type { CapturedFixture } from './fixture-types.js';
import { runSynthesisLoop } from './loop.js';
import { buildProbeSuite } from './probe-suite.js';
import { loadAdapterInSandbox } from './sandbox-host.js';
import { type Verdict, validateAdapter } from './validate.js';

const BASE_URL = 'https://nano-gpt.com/api/v1';
const ANALYZER_MODEL_ID = 'zai-org/glm-5.1';
const TARGET_BARE = 'deepseek/deepseek-v4-pro';
const TARGET_THINKING = 'deepseek/deepseek-v4-pro:thinking';
const MAX_ROUNDS = 3;

async function main(): Promise<void> {
  const apiKey = process.env.NANO_GPT_API_KEY;
  if (!apiKey) throw new Error('NANO_GPT_API_KEY is not set (see .env.example)');

  // The registry is populated as a side-effect of the package index, which the
  // CLI does not import — register the built-ins explicitly (idempotent).
  registerBuiltinProviders();

  // 1–2. Probe + capture verbatim evidence.
  console.log('Probing target and capturing fixtures...');
  const probes = buildProbeSuite({ thinkingSlug: TARGET_THINKING, bareSlug: TARGET_BARE });
  const fixtures: CapturedFixture[] = [];
  for (const probe of probes) {
    const fx = await runProbe({ baseUrl: BASE_URL, apiKey, probe });
    console.log(`  ${probe.dimension}: HTTP ${fx.status} (${fx.rawResponse.length} bytes)`);
    fixtures.push(fx);
  }

  const fixtureDir = resolve(import.meta.dir, '..', '..', 'fixtures');
  await writeFile(
    join(fixtureDir, 'deepseek-v4-pro.fixtures.json'),
    JSON.stringify(fixtures, null, 2),
  ).catch((e) => console.warn(`  (could not persist fixtures: ${(e as Error).message})`));

  const observed = deriveObservedProfile(fixtures);
  console.log('Observed facts:', observed);

  // 3–5. Generate + validate with self-repair.
  const contract = await readFile(resolve(import.meta.dir, '..', 'adapter-contract.ts'), 'utf8');
  const provider = getProvider('nano-gpt');
  if (!provider) throw new Error('nano-gpt provider not registered');
  const analyzerModel = provider.knownModels.find((m) => m.id === ANALYZER_MODEL_ID);
  if (!analyzerModel) throw new Error(`analyzer model ${ANALYZER_MODEL_ID} not in known models`);
  const baselinePath = resolve(
    import.meta.dir,
    '..',
    'adapters',
    'nano-gpt-deepseek.baseline.sandbox.ts',
  );
  const workDir = await mkdtemp(join(tmpdir(), 'adapter-synth-'));
  let attempt = 0;

  const result = await runSynthesisLoop({
    maxRounds: MAX_ROUNDS,
    generate: async (priorFailures) => {
      attempt += 1;
      console.log(`\nRound ${attempt}: asking ${ANALYZER_MODEL_ID} to write the adapter...`);
      const prompt = buildAnalyzerPrompt({
        contract,
        providerDocs: 'nano-gpt is OpenAI chat-completions compatible at /chat/completions.',
        fixtures,
        priorFailures,
      });
      // Stream the analyzer's reply. A non-streaming call to a reasoning model
      // holds an idle connection for the whole (multi-minute) generation and
      // gets killed by a TimeoutError; streaming keeps bytes flowing. We only
      // need the final answer text (the code block), so reasoning chunks are
      // ignored. `reasoning: { enabled: true }` selects the :thinking slug.
      let reply = '';
      for await (const chunk of streamCompletion({
        provider,
        providerConfig: { baseUrl: BASE_URL, routing: { kind: 'direct' } },
        apiKey,
        corsProxyUrl: null,
        corsProxyKey: null,
        model: analyzerModel,
        messages: [{ role: 'user', content: prompt }],
        bodyExtras: { reasoning: { enabled: true } },
        initialResponseTimeoutMs: 120_000,
      })) {
        if (chunk.type === 'token') {
          reply += chunk.text;
          process.stdout.write('.');
        } else if (chunk.type === 'error') {
          console.warn(`\n  (stream error chunk: ${chunk.message})`);
        }
      }
      process.stdout.write('\n');
      return extractAdapterModule(reply);
    },
    validate: async (source): Promise<Verdict> => {
      const modPath = join(workDir, `candidate-${attempt}.ts`);
      await writeFile(modPath, source);
      // A generated adapter that fails to load (syntax/import error) is a
      // failed round, not a crash — feed the error back for self-repair.
      let candidate: Awaited<ReturnType<typeof loadAdapterInSandbox>>;
      try {
        candidate = await loadAdapterInSandbox(modPath);
      } catch (e) {
        return { passed: false, failures: [`adapter failed to load: ${(e as Error).message}`] };
      }
      try {
        const baseline = await loadAdapterInSandbox(baselinePath);
        try {
          const verdict = await validateAdapter({ candidate, baseline, fixtures });
          console.log(
            verdict.passed
              ? '  validation: PASS'
              : `  validation: FAIL (${verdict.failures.length})`,
          );
          return verdict;
        } finally {
          baseline.dispose();
        }
      } finally {
        candidate.dispose();
      }
    },
  });

  console.log(`\nVerdict: ${result.outcome} after ${result.rounds} round(s).`);
  if (result.outcome === 'verified') {
    console.log('Generated adapter written to:', join(workDir, `candidate-${attempt}.ts`));
  } else {
    console.log('Last failures:\n', result.lastFailures.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
