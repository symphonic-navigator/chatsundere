// SPDX-License-Identifier: LGPL-3.0-only
// One-time fixture generator (not shipped, not a test). Embeds the shared corpus
// with the SAME model/pooling/prefix as production and writes the fp32 vectors to
// a binary the recall test loads — so CI guards recall@10 without loading the model.
// Run once after `pnpm --filter @chatsundere/embeddings run fetch-model`:
//   bun run dev/dump-fixture.ts   (from packages/embeddings)
// Output layout (little-endian): [count:f32][dim:f32] then count*dim f32 values.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { MODEL_ID, POOLING, applyPrefix } from '../src/engine/model-config.js';
import { CORPUS } from './corpus.js';

const here = dirname(fileURLToPath(import.meta.url));

// Self-hosted model on disk (already fetched under public/model/<MODEL_ID>/).
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = `${join(here, '..', 'public', 'model')}/`;
// Runs on the cpu backend (onnxruntime-node): headless Bun/Node has no WASM/WebGPU
// environment. The int8 ONNX graph is the same across execution providers, so the
// vectors match what production (WASM/WebGPU in the browser) produces.

const extractor = await pipeline('feature-extraction', MODEL_ID, {
  dtype: 'int8',
  device: 'cpu',
});

const prefixed = CORPUS.map((t) => applyPrefix(t, 'document'));
const output = await extractor(prefixed, { normalize: true, pooling: POOLING });
const rows = output.tolist() as number[][];

if (rows.length === 0 || (rows[0]?.length ?? 0) === 0) {
  throw new Error(
    'Extractor returned no vectors — check that the model is present and loaded correctly.',
  );
}

const count = rows.length;
const dim = rows[0]?.length ?? 0;
// Float32 stores integers exactly up to 2^24; count and dim are always far below that.
const out = new Float32Array(2 + count * dim);
out[0] = count;
out[1] = dim;
let p = 2;
for (const r of rows) for (const x of r) out[p++] = x;

const dest = join(here, '..', 'tests', 'fixtures', 'corpus-vectors.f32.bin');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, Buffer.from(out.buffer));
console.log(
  `Wrote ${count} × ${dim} fp32 vectors → ${dest} (${(out.byteLength / 1e3).toFixed(0)} KB)`,
);
