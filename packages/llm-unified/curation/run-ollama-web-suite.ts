// SPDX-License-Identifier: LGPL-3.0-only
//
// Live verification harness for the Ollama Cloud web-interfacing offerings (run
// via /curate, NEVER in CI — needs an Ollama key). Exercises the SHIPPED adapters
// end-to-end against the real `/api/web_search` and `/api/web_fetch` endpoints,
// asserting a non-empty, well-shaped result. Routing is `direct` (server-side
// Bun: no CORS — the browser path routes through the user's CORS proxy instead).
//
//   OLLAMA_API_KEY=$(cat keys/.ollama-test-key) bun run curation/run-ollama-web-suite.ts
//     (from packages/llm-unified), or rely on the keys/.ollama-test-key fallback.
import { readFileSync } from 'node:fs';
import type { WebContext } from '../src/integrations/web-interfacing.js';
import { ollamaWebFetchAdapter, ollamaWebSearchAdapter } from '../src/web-adapters/ollama-web.js';

function readKey(): string {
  const fromEnv = process.env.OLLAMA_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return readFileSync(new URL('../../../keys/.ollama-test-key', import.meta.url), 'utf8').trim();
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

// Mirror of the curated `searchTiers` in providers/ollama-cloud.ts — exercised
// live so an Ollama API change to `max_results` is caught at curation time.
const SEARCH_TIERS = [
  { id: 'standard', params: { numResults: 5 } },
  { id: 'quick', params: { numResults: 3 } },
  { id: 'deep', params: { numResults: 10 } },
];

interface Line {
  label: string;
  ok: boolean;
  detail: string;
}

async function run(): Promise<void> {
  const lines: Line[] = [];

  for (const tier of SEARCH_TIERS) {
    try {
      const adapter = ollamaWebSearchAdapter();
      // biome-ignore lint/style/noNonNullAssertion: the search adapter always defines search
      const result = await adapter.search!(SEARCH_QUERY, ctx, apiKey, tier.params);
      const ok = result.hits.length > 0 && result.hits.every((h) => h.url.length > 0);
      lines.push({
        label: `search:${tier.id}`,
        ok,
        detail: ok ? `${result.hits.length} hits` : 'no usable hits',
      });
    } catch (e) {
      lines.push({
        label: `search:${tier.id}`,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    const adapter = ollamaWebFetchAdapter();
    // biome-ignore lint/style/noNonNullAssertion: the fetch adapter always defines fetch
    const result = await adapter.fetch!(FETCH_URL, ctx, apiKey);
    const ok = result.content.length > 100;
    lines.push({
      label: 'fetch:web_fetch',
      ok,
      detail: ok ? `${result.content.length} chars of content` : 'empty/short content',
    });
  } catch (e) {
    lines.push({
      label: 'fetch:web_fetch',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const pass = lines.filter((l) => l.ok).length;
  console.log('\nOllama Cloud web-interfacing live suite');
  console.log('───────────────────────────────────');
  for (const l of lines) {
    console.log(`${l.ok ? '✅' : '❌'} ${l.label.padEnd(16)} ${l.detail}`);
  }
  console.log('───────────────────────────────────');
  console.log(`${pass}/${lines.length} passed\n`);
  if (pass !== lines.length) process.exit(1);
}

void run();
