// SPDX-License-Identifier: LGPL-3.0-only
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { getProvider } from '../registry.js';
import { buildRequest } from '../transport.js';
import { buildOffering } from './build.js';
import { HELP_TEXT, type Intent, parseArgs } from './cli-dispatch.js';
import { assembleOfferings, parseModelFile, renderTemplate } from './model-file.js';
import { groupNanoGptSlugs } from './provider-scanner.js';
import { renderReport } from './report.js';
import { synthesiseOffering } from './synthesise.js';
import { writeBuiltBlock } from './write-back.js';

const ANALYZER_MODEL_ID = 'zai-org/glm-5.1';
const REGISTERED = ['nano-gpt', 'novita', 'ollama-cloud'] as const;

/** repo-root/obsidian/models/<id>.md from this file (src/curate). */
function reportPath(canonicalId: string): string {
  return resolve(
    import.meta.dir,
    '..',
    '..',
    '..',
    '..',
    'obsidian',
    'models',
    `${canonicalId}.md`,
  );
}

function requireKey(): string {
  const key = process.env.NANO_GPT_API_KEY;
  if (!key) throw new Error('NANO_GPT_API_KEY is not set (see .env.example)');
  return key;
}

async function main(): Promise<void> {
  const intent = parseArgs(process.argv.slice(2));
  registerBuiltinProviders();

  switch (intent.kind) {
    case 'help':
      console.log(HELP_TEXT);
      return;
    case 'provider-list':
      for (const id of REGISTERED)
        console.log(getProvider(id) ? `  ${id}` : `  ${id} (not registered)`);
      return;
    case 'model-template':
      process.stdout.write(template(intent.refs));
      return;
    case 'model-list':
      await modelList(intent.provider);
      return;
    case 'model-build':
      await modelBuild(intent.file, intent.verify);
      return;
    case 'model-report':
      await modelReport(intent.ref);
      return;
    case 'model-verify':
      console.log('`model verify` is not implemented yet — re-run `model build --verify`.');
      return;
    default:
      console.log(HELP_TEXT);
  }
}

function template(refs: string[]): string {
  const offerings = refs.map((r) => {
    const i = r.indexOf(':');
    return { provider: r.slice(0, i), upstreamSlug: r.slice(i + 1) };
  });
  const slug = offerings[0]?.upstreamSlug ?? 'model';
  const canonicalId = (slug.split('/').pop() ?? 'model').replace(/:.*$/, '');
  return renderTemplate({
    canonicalId,
    displayName: canonicalId,
    family: canonicalId.split('-')[0] ?? canonicalId,
    offerings,
  });
}

async function modelList(provider: string | null): Promise<void> {
  const apiKey = requireKey();
  const id = provider ?? 'nano-gpt';
  const def = getProvider(id);
  if (!def) throw new Error(`provider ${id} not registered`);
  const request = buildRequest({
    provider: { baseUrl: def.baseUrl, routing: { kind: 'direct' } },
    apiKey,
    corsProxyUrl: null,
    corsProxyKey: null,
    path: '/models',
    method: 'GET',
  });
  const res = await fetch(request);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const slugs = (json.data ?? [])
    .map((d) => d.id)
    .filter((s): s is string => typeof s === 'string');
  const groups =
    id === 'nano-gpt'
      ? groupNanoGptSlugs(slugs)
      : slugs.map((s) => ({ providerId: id, baseSlug: s }) as const);
  for (const g of groups) {
    const tee = 'teeVariant' in g && g.teeVariant ? ' [TEE]' : '';
    const reasoning = 'reasoningVariant' in g && g.reasoningVariant ? ' +reasoning' : '';
    console.log(`  ${g.baseSlug}${tee}${reasoning}`);
  }
}

async function modelBuild(file: string, verify: boolean): Promise<void> {
  const apiKey = requireKey();
  const filePath = resolve(file);
  const source = await readFile(filePath, 'utf8');
  const parsed = parseModelFile(parseYaml(source));
  if (!parsed.ok) throw new Error(`invalid model file:\n${parsed.errors.join('\n')}`);
  const f = parsed.file;

  const analyzerProvider = getProvider('nano-gpt');
  if (!analyzerProvider) throw new Error('nano-gpt provider not registered');
  const analyzerModel = analyzerProvider.knownModels.find((m) => m.id === ANALYZER_MODEL_ID);
  if (!analyzerModel) throw new Error(`analyzer model ${ANALYZER_MODEL_ID} not in known models`);
  const contract = await readFile(resolve(import.meta.dir, '..', 'adapter-contract.ts'), 'utf8');

  const built = [];
  for (const human of f.offerings) {
    const targetProvider = getProvider(human.provider);
    if (!targetProvider) {
      console.warn(`  skipping ${human.provider}: provider not registered`);
      continue;
    }
    console.log(`\nBuilding ${human.provider}:${f.canonical.id} (${human.upstreamSlug})...`);
    const result = await buildOffering({
      human,
      canonicalId: f.canonical.id,
      runLoop: () =>
        synthesiseOffering({
          human,
          canonical: f.canonical,
          apiKey,
          contract,
          provider: targetProvider,
          analyzerProvider,
          analyzerModel,
        }),
    });
    console.log(`  → ${result.built.confidence}`);
    if (result.adapterSource) {
      await writeFile(join(dirname(filePath), result.built.adapterFile), result.adapterSource);
    }
    built.push(result.built);
  }

  await writeFile(filePath, writeBuiltBlock(source, built));
  const offerings = assembleOfferings({ ...f, built });
  await writeFile(reportPath(f.canonical.id), renderReport(f.canonical, offerings)).catch((e) =>
    console.warn(`  (report not written: ${(e as Error).message})`),
  );
  console.log(`\nDone. Report: obsidian/models/${f.canonical.id}.md`);
  if (verify) {
    // Validation already runs inside the synthesis loop for every offering. A
    // separate post-build re-probe (the intended `--verify` semantics) is not
    // implemented yet — be honest rather than imply it ran.
    console.log('(--verify: a separate post-build re-probe is not implemented yet — see README)');
  }
}

async function modelReport(ref: string): Promise<void> {
  const source = await readFile(resolve(ref), 'utf8');
  const parsed = parseModelFile(parseYaml(source));
  if (!parsed.ok) throw new Error(`invalid model file:\n${parsed.errors.join('\n')}`);
  const offerings = assembleOfferings(parsed.file);
  await writeFile(
    reportPath(parsed.file.canonical.id),
    renderReport(parsed.file.canonical, offerings),
  );
  console.log(`Report written: obsidian/models/${parsed.file.canonical.id}.md`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export type { Intent };
