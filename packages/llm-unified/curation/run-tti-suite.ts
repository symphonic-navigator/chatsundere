// SPDX-License-Identifier: LGPL-3.0-only
//
// Live TTI verification harness (run via the /curate skill, NEVER in CI — it
// needs keys/.nano-test-key and keys/.xai-test-key and spends real money,
// about $2.50 for the full matrix including FLUX.3 4k). For every TTI offering
// it generates one image per priced resolution × quality cell at the default
// aspect through the real generateImages(), checks the returned pixel
// dimensions against the descriptor, and prints wall-clock time and image
// size. Billed cost is printed by the provider dashboards, not here.
//
//   bun run curation/run-tti-suite.ts              (from packages/llm-unified)
//   bun run curation/run-tti-suite.ts flux         (slug substring filter)
import { existsSync, readFileSync } from 'node:fs';
import { registerBuiltinProviders } from '../src/providers/_register-builtins.js';
import { getProvider, listTtiOfferings } from '../src/registry.js';
import type { ImageModelConfig, TtiDescriptor } from '../src/tti/descriptor.js';
import { generateImages } from '../src/tti/generate-images.js';
import { latencyFor, priceCentsFor } from '../src/tti/image-config.js';

const KEY_FILES: Record<string, string> = { 'nano-gpt': '.nano-test-key', xai: '.xai-test-key' };

function keyUrl(providerId: string): URL {
  const file = KEY_FILES[providerId];
  if (!file) throw new Error(`no key file mapped for ${providerId}`);
  return new URL(`../../../keys/${file}`, import.meta.url);
}

function readKey(providerId: string): string {
  return readFileSync(keyUrl(providerId), 'utf8').trim();
}

/** Width × height from PNG / JPEG / WebP bytes; [0, 0] when unknown. */
function dimensions(bytes: Uint8Array): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return [view.getUint32(16), view.getUint32(20)];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xc2) return [view.getUint16(i + 7), view.getUint16(i + 5)];
      i += 2 + view.getUint16(i + 2);
    }
  }
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (isWebp && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38) {
    const b = (i: number): number => bytes[i] ?? 0;
    if (bytes[15] === 0x20)
      return [(b(26) | (b(27) << 8)) & 0x3fff, (b(28) | (b(29) << 8)) & 0x3fff];
    if (bytes[15] === 0x4c) {
      return [
        1 + (b(21) | ((b(22) & 0x3f) << 8)),
        1 + ((b(22) >> 6) | (b(23) << 2) | ((b(24) & 0x0f) << 10)),
      ];
    }
  }
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[12] === 0x56 && bytes[15] === 0x58) {
    const w = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const h = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return [w, h];
  }
  return [0, 0];
}

function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return (w ?? 1) / (h ?? 1);
}

/** Exact for size tables; within 3 % of the aspect ratio otherwise. */
function dimensionVerdict(
  meta: TtiDescriptor,
  config: ImageModelConfig,
  w: number,
  h: number,
): string {
  if (meta.wire.kind === 'size-table') {
    const want = meta.wire.sizes[`${config.aspect}|${config.resolution ?? '-'}`];
    if (!want) return `FAIL no size-table entry for ${config.aspect}|${config.resolution ?? '-'}`;
    return want[0] === w && want[1] === h ? 'PASS exact' : `FAIL want ${want.join('x')}`;
  }
  if (w === 0 || h === 0) return 'FAIL unknown image format';
  const drift = Math.abs(w / h - ratioOf(config.aspect)) / ratioOf(config.aspect);
  return drift <= 0.03 ? 'PASS ratio' : `FAIL ratio drift ${(drift * 100).toFixed(1)} %`;
}

function cells(meta: TtiDescriptor): ImageModelConfig[] {
  const out: ImageModelConfig[] = [];
  for (const resolution of meta.resolutions?.map((r) => r.id) ?? [null]) {
    for (const quality of meta.qualities?.map((q) => q.id) ?? [null]) {
      out.push({ aspect: meta.defaults.aspect, resolution, quality });
    }
  }
  return out;
}

registerBuiltinProviders();
const filter = process.argv[2];
let failures = 0;

// Fail before any request is sent (and any money spent) if a key is missing.
const neededProviders = new Set(
  listTtiOfferings()
    .filter((o) => o.tti && (!filter || o.upstreamSlug.includes(filter)))
    .map((o) => o.providerId),
);
const missingKeys = [...neededProviders].filter((id) => !existsSync(keyUrl(id)));
if (missingKeys.length > 0) {
  console.error(
    `Missing key file(s): ${missingKeys.map((id) => `keys/${KEY_FILES[id]} (${id})`).join(', ')}. Nothing was sent.`,
  );
  process.exit(1);
}

for (const o of listTtiOfferings()) {
  const meta = o.tti;
  if (!meta) continue;
  if (filter && !o.upstreamSlug.includes(filter)) continue;
  const provider = getProvider(o.providerId);
  if (!provider) continue;
  const apiKey = readKey(o.providerId);
  for (const config of cells(meta)) {
    const label = `${o.providerId}:${o.upstreamSlug} ${config.resolution ?? '-'}|${config.quality ?? '-'}`;
    const t0 = performance.now();
    try {
      const result = await generateImages({
        providerConfig: { baseUrl: provider.baseUrl, routing: { kind: 'direct' } },
        apiKey,
        slug: o.upstreamSlug,
        meta,
        config,
        prompt: 'A small red fox sitting in a snowy birch forest at dawn, soft watercolour',
        count: 1,
      });
      const seconds = ((performance.now() - t0) / 1000).toFixed(0);
      const item = result.items[0];
      if (item?.kind !== 'image') {
        failures++;
        console.log(`FAIL ${label}: ${item?.kind ?? 'no item'} after ${seconds} s`);
        continue;
      }
      const bytes = new Uint8Array(await item.bytes.arrayBuffer());
      const [w, h] = dimensions(bytes);
      const verdict = dimensionVerdict(meta, config, w, h);
      const price = priceCentsFor(meta, config);
      if (verdict.startsWith('FAIL')) failures++;
      console.log(
        `${verdict} ${label}: ${w}x${h} ${item.mime} ${Math.round(bytes.length / 1024)} KiB in ${seconds} s` +
          ` (descriptor: ${price === undefined ? '?' : `${price}¢`}, ${latencyFor(meta, config) ?? 'no latency hint'})`,
      );
    } catch (e) {
      failures++;
      console.log(`FAIL ${label}: ${(e as Error).message}`);
    }
  }
}

console.log(`\nDONE — ${failures} failure(s).`);
