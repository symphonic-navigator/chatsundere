// SPDX-License-Identifier: LGPL-3.0-only
// Downloads the self-hosted arctic-embed-m-v2.0 weights and verifies SHA256.
// int8 is the WASM backend's weight format; q4f16 is the WebGPU backend's
// (4-bit + fp16, needs the shader-f16 device feature). Both are fetched so the
// runtime can pick per device; a client only downloads the one its device uses.
// Usage: node scripts/fetch-model.mjs
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Snowflake/snowflake-arctic-embed-m-v2.0';
// Pinned to a commit SHA for reproducible Docker image layers (the model is
// baked into the frontend image at build time). Bump deliberately when the
// upstream weights change.
const REVISION = '95c2741480856aa9666782eb4afe11959938017f';
const BASE = `https://huggingface.co/${REPO}/resolve/${REVISION}`;

// transformers.js expects this on-disk layout under localModelPath ('/model/'):
//   <root>/<REPO>/{config,tokenizer,tokenizer_config,special_tokens_map}.json
//   <root>/<REPO>/onnx/{model_int8,model_q4f16}.onnx
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_int8.onnx',
  'onnx/model_q4f16.onnx',
];

// Pinned against the REVISION above. Any mismatch aborts the download — guards
// the baked-in image layer against corrupted or substituted upstream bytes.
const EXPECTED_SHA256 = {
  'config.json': '2e0b386e7a826903b06c301f8d4dde2ac6279f7ccd3ea11f3911019a1ee0bc05',
  'tokenizer.json': 'f1cc44ad7faaeec47241864835473fd5403f2da94673f3f764a77ebcb0a803ec',
  'tokenizer_config.json': '6f00514620aff01ba8b7291b2394e98daca5be264cb743805232d9ae27494b2a',
  'special_tokens_map.json': '8c785abebea9ae3257b61681b4e6fd8365ceafde980c21970d001e834cf10835',
  'onnx/model_int8.onnx': '03d923bb1850ebdccb068e2f3abd8aa43fe81c50d07d037ef103fe3d0fb78e3b',
  'onnx/model_q4f16.onnx': '3cabedcefa1a1c1a8f8c6bb46bad75219f23ef73892580bcf59e96b03b941e5c',
};

const here = dirname(fileURLToPath(import.meta.url));
// Output dir override (e.g. the user-client serves the weights at its own
// /model/). MODEL_OUT_DIR is resolved against the caller's cwd; default is this
// package's own public/model (for the standalone embeddings dev server).
const outRoot = process.env.MODEL_OUT_DIR
  ? join(process.env.MODEL_OUT_DIR, REPO)
  : join(here, '..', 'public', 'model', REPO);

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

for (const rel of FILES) {
  const url = `${BASE}/${rel}`;
  process.stdout.write(`Fetching ${rel} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = sha256(buf);
  const expected = EXPECTED_SHA256[rel];
  if (expected && expected !== digest) {
    throw new Error(`SHA256 mismatch for ${rel}: expected ${expected}, got ${digest}`);
  }
  const dest = join(outRoot, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`ok (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${digest.slice(0, 12)}…)`);
}
console.log(
  '\nDone. If EXPECTED_SHA256 is empty, paste the printed hashes into the script to pin them.',
);
