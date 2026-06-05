// SPDX-License-Identifier: LGPL-3.0-only
import Dexie, { type Table } from 'dexie';
import {
  VECTORS_STORE_SCHEMA,
  type VectorRow,
  cosineFromQuant,
  createEmbeddingEngine,
  createVectorStore,
  formatBackendLabel,
  quantiseMaxAbs,
} from '../src/index.js';

const out = document.getElementById('out');
if (!out) throw new Error('missing #out element');
const log = (s: string) => {
  out.textContent += `\n${s}`;
};

class DemoDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor() {
    super('embeddings_dev_demo');
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

function fp32Cos(a: Float32Array, b: Float32Array): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    d += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : d / denom;
}

function int8Cos(a: Float32Array, b: Float32Array): number {
  return cosineFromQuant(quantiseMaxAbs(a), quantiseMaxAbs(b));
}

async function main() {
  // Re-check so TypeScript knows `out` is non-null inside this async function scope.
  const display = document.getElementById('out');
  if (!display) throw new Error('missing #out element');
  display.textContent = 'creating engine…';
  const engine = await createEmbeddingEngine({
    onProgress: (d) => log(`progress: ${JSON.stringify(d)}`),
  });
  log(`backend: ${formatBackendLabel(engine.backend)}`);
  log(`crossOriginIsolated: ${globalThis.crossOriginIsolated}`);

  // 1) Model-card sanity + int8 delta.
  const queryVecs = await engine.embed(['what is snowflake?'], { kind: 'query' });
  const q = queryVecs[0];
  if (!q) throw new Error('no query embedding');
  const docLabels = ['The Data Cloud!', 'Mexico City of Course!'];
  const docs = await engine.embed(docLabels, { kind: 'document' });
  for (let i = 0; i < docLabels.length; i++) {
    const doc = docs[i];
    const label = docLabels[i];
    if (!doc) continue;
    const fp = fp32Cos(q, doc);
    const q8 = int8Cos(q, doc);
    log(
      `sanity "${label}": fp32 ${fp.toFixed(4)} | int8 ${q8.toFixed(4)} | Δ ${(q8 - fp).toFixed(4)}`,
    );
  }
  log('(expected fp32 references ~0.327 and ~0.070; int8 Δ should be small)');

  // 2) Multilingual exploration — degenerate-output + cross-lingual retrieval.
  const multilingual = [
    { lang: 'en', text: 'The cat sleeps on the warm windowsill.' },
    { lang: 'de', text: 'Die Katze schläft auf der warmen Fensterbank.' },
    { lang: 'ru', text: 'Кошка спит на тёплом подоконнике.' },
    { lang: 'ja', text: '猫が暖かい窓辺で眠っている。' },
    { lang: 'zh', text: '猫在温暖的窗台上睡觉。' },
    { lang: 'en2', text: 'Quarterly revenue exceeded all forecasts.' },
  ];
  const mvecs = await engine.embed(
    multilingual.map((m) => m.text),
    { kind: 'document' },
  );
  for (let i = 0; i < multilingual.length; i++) {
    const v = mvecs[i];
    const entry = multilingual[i];
    if (!v || !entry) continue;
    let sumSq = 0;
    let finite = true;
    for (let j = 0; j < v.length; j++) {
      const x = v[j] ?? 0;
      sumSq += x * x;
      if (!Number.isFinite(x)) finite = false;
    }
    log(`[${entry.lang}] finite=${finite} norm=${Math.sqrt(sumSq).toFixed(3)}`);
  }
  const enQueryVecs = await engine.embed(['A feline rests by the sunny window.'], {
    kind: 'query',
  });
  const enQuery = enQueryVecs[0];
  if (!enQuery) throw new Error('no query embedding');
  const ranked = multilingual
    .map((m, i) => {
      const v = mvecs[i];
      return { lang: m.lang, cos: v ? int8Cos(enQuery, v) : 0 };
    })
    .sort((a, b) => b.cos - a.cos);
  log(
    `cross-lingual ranking for "cat by window": ${ranked.map((r) => `${r.lang}:${r.cos.toFixed(2)}`).join(' ')}`,
  );
  log('(the 5 cat sentences should outrank the revenue sentence regardless of script)');

  // 3) Filter + query round-trip through the store.
  const db = new DemoDb();
  await db.open();
  const store = createVectorStore({ db, table: db.vectors, engine });
  const records = multilingual
    .map((entry, i) => {
      const v = mvecs[i];
      if (!v) return null;
      return {
        id: entry.lang,
        collection: 'demo',
        vector: v,
        tags: { script: ['ru', 'ja', 'zh'].includes(entry.lang) ? 'non-latin' : 'latin' },
        numeric: { idx: i },
        updatedAt: Date.now(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  await store.upsert(records);
  const latinHits = await store.query({
    collection: 'demo',
    text: 'A feline rests by the sunny window.',
    filter: { tags: { script: 'latin' } },
    topK: 3,
  });
  log(
    `store query (latin only): ${latinHits.map((h) => `${h.id}:${h.score.toFixed(2)}`).join(' ')}`,
  );
  log(`usage: ${JSON.stringify(await store.usage())}`);
  await Dexie.delete('embeddings_dev_demo');

  engine.dispose();
  log('\n✅ smoke complete');
}

main().catch((e) => log(`\n❌ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
