// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the nano-gpt web-interfacing offerings (run via
// /curate, NEVER in CI — needs a nano-gpt key). Exercises the SHIPPED adapters
// end-to-end against the real `/api/web` (linkup/exa/brave search) and
// `/scrape-urls` (fetch) endpoints, asserting a non-empty, well-shaped result.
// Routing is `direct` (server-side Bun: no CORS, talk to nano-gpt directly —
// the browser path routes through the user's CORS proxy instead).
//
//   NANOGPT_API_KEY=$(cat keys/.nano-test-key) bun run curation/run-web-suite.ts
//     (from packages/llm-unified), or rely on the keys/.nano-test-key fallback.
import { readFileSync } from 'node:fs';
import type { WebContext } from '../src/integrations/web-interfacing.js';
import {
  nanoGptWebScrapeAdapter,
  nanoGptWebSearchAdapter,
} from '../src/web-adapters/nano-gpt-web.js';

function readKey(): string {
  const fromEnv = process.env.NANOGPT_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return readFileSync(new URL('../../../keys/.nano-test-key', import.meta.url), 'utf8').trim();
}

const apiKey = readKey();

// Direct routing — no proxy server-side.
const ctx: WebContext = {
  nsfwAllowed: false,
  location: null,
  useProxy: false,
};

const SEARCH_QUERY = 'latest stable Bun runtime version in 2026';
const FETCH_URL = 'https://endoflife.date/bun';

// Mirror of the curated `searchTiers` in providers/nano-gpt.ts — exercised live
// so a nano-gpt API change (e.g. dropping `numResults` or a `depth` value) is
// caught at curation time, not silently ignored.
const SEARCH_TIERS: Record<
  'linkup' | 'exa' | 'brave',
  { id: string; params: Record<string, unknown> }[]
> = {
  linkup: [
    { id: 'standard', params: { depth: 'standard' } },
    { id: 'deep', params: { depth: 'deep' } },
  ],
  exa: [
    { id: 'quick', params: { depth: 'auto', numResults: 8 } },
    { id: 'neural', params: { depth: 'neural', numResults: 8 } },
  ],
  brave: [{ id: 'standard', params: { depth: 'standard' } }],
};

interface Line {
  label: string;
  ok: boolean;
  detail: string;
}

async function run(): Promise<void> {
  const lines: Line[] = [];

  for (const provider of ['linkup', 'exa', 'brave'] as const) {
    for (const tier of SEARCH_TIERS[provider]) {
      try {
        const adapter = nanoGptWebSearchAdapter(provider);
        // biome-ignore lint/style/noNonNullAssertion: the search adapter always defines search
        const result = await adapter.search!(SEARCH_QUERY, ctx, apiKey, tier.params);
        const ok = result.hits.length > 0 && result.hits.every((h) => h.url.length > 0);
        lines.push({
          label: `search:${provider}/${tier.id}`,
          ok,
          detail: ok ? `${result.hits.length} hits` : 'no usable hits',
        });
      } catch (e) {
        lines.push({
          label: `search:${provider}/${tier.id}`,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  try {
    const adapter = nanoGptWebScrapeAdapter();
    // biome-ignore lint/style/noNonNullAssertion: the scrape adapter always defines fetch
    const result = await adapter.fetch!(FETCH_URL, ctx, apiKey);
    const ok = result.content.length > 100;
    lines.push({
      label: 'fetch:scrape',
      ok,
      detail: ok ? `${result.content.length} chars of markdown` : 'empty/short content',
    });
  } catch (e) {
    lines.push({
      label: 'fetch:scrape',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const pass = lines.filter((l) => l.ok).length;
  console.log('\nnano-gpt web-interfacing live suite');
  console.log('───────────────────────────────────');
  for (const l of lines) {
    console.log(`${l.ok ? '✅' : '❌'} ${l.label.padEnd(16)} ${l.detail}`);
  }
  console.log('───────────────────────────────────');
  console.log(`${pass}/${lines.length} passed\n`);
  if (pass !== lines.length) process.exit(1);
}

void run();
