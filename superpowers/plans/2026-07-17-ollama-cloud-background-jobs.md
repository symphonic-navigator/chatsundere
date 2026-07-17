# Ollama Cloud background-job repair — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make title generation, memory and compaction work on Ollama Cloud by deleting the parallel one-shot wire path, and make `temperature` / `max_tokens` reach Ollama at all.

**Architecture:** `runOneShotCompletion` stops composing its own wire and becomes a thin fold over `streamCompletion`, which already honours the adapter's `path` and `responseFraming`. A new optional `mapSampling` hook lets the ollama adapter nest sampling under `options`, which is the only form Ollama reads. The suite's binding stops reimplementing wire composition and shares `composeWire`, so it verifies the pipe production uses.

**Tech Stack:** TypeScript (strict), Bun test runner, Valibot, `pnpm` + Turborepo.

Spec: [`superpowers/specs/2026-07-17-ollama-cloud-background-jobs-design.md`](../specs/2026-07-17-ollama-cloud-background-jobs-design.md). Read §3 (root cause) and §5 (design) before starting.

## Global Constraints

- **British English** in every artefact — code, comments, commit messages, log strings. No exceptions. The chat with Chris is the only German surface.
- **TypeScript strict**: `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline comment justifying it.
- Every package-public function carries at least a one-line JSDoc.
- Comments explain non-obvious **why**, never restate the code.
- **Gate before every commit:** `pnpm typecheck` (not just `pnpm run build`) — and at the final gate use `pnpm typecheck --force`, because Turbo caches typecheck and a test-only change can get a cached pass.
- **Backend tests** run on Bun's built-in runner: `bun test <path>` from `packages/llm-unified`.
- **Never commit provider keys.** Live suites read `keys/.ollama-test-key` and never run in CI.
- **Do not merge, push, or switch branches.** Liz owns all git integration.
- Commit messages: free-form imperative, capitalised subject, no Conventional Commits prefix. Co-author trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/llm-unified/src/adapter-contract.ts` | Add the optional `mapSampling` hook to `ModelAdapter`. |
| `packages/llm-unified/src/adapters/ollama-native.ts` | Implement `mapSampling` → `{ options: … }`. |
| `packages/llm-unified/src/stream-completion.ts` | Honour `mapSampling`; export `composeWire`; add `operation`; throw `UpstreamHttpError`. |
| `packages/llm-unified/src/one-shot-completion.ts` | Delete the parallel wire path; fold `streamCompletion` chunks. |
| `packages/llm-unified/src/index.ts` | Export `UpstreamHttpError`. |
| `packages/llm-unified/curation/conversation-suite/binding.ts` | Use `composeWire`; accept `sampling`; add `makeOneShotBinding`. |
| `packages/llm-unified/curation/conversation-suite/assertions.ts` | Add `assertUsageWithinCap`, `assertTextPresent`. |
| `packages/llm-unified/curation/conversation-suite/scenarios/core.ts` | Add the sampling-cap turn. |
| `obsidian/providers/ollama-cloud.md` | Record the truth (Task 8). |

### Deviation from the spec (deliberate, flagged)

The spec proposes `RunnerBinding.runOneShot?` as an optional interface member.
**That does not work:** `runSuite` → `runPermutation` only ever calls
`binding.runTurn` (`runner.ts:49`), so an optional `runOneShot` would never
execute without also rewriting the runner and `ScenarioTurn`. Task 7 therefore
adds a **`makeOneShotBinding` factory** whose `runTurn` drives the one-shot path.
Same coverage, no interface churn, no report-semantics change for a "skipped"
turn. `RunnerBinding` is untouched.

---

### Task 1: `mapSampling` hook + ollama-native implementation

**Files:**
- Modify: `packages/llm-unified/src/adapter-contract.ts:56-71`
- Modify: `packages/llm-unified/src/adapters/ollama-native.ts:88-107`
- Test: `packages/llm-unified/src/adapters/ollama-native.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ModelAdapter.mapSampling?(sampling: Record<string, unknown>): Record<string, unknown>` — optional. Returns a **body fragment** to merge (for ollama: `{ options: {...} }`), or `{}` when there is nothing to map. Task 2 consumes it.

**Context:** Measured 2026-07-17 — Ollama ignores top-level `temperature` / `max_tokens` silently (HTTP 200 with `temperature: 5`), but validates `options.temperature` (HTTP 400: "temperature must be between 0.0 and 2.0"). Its documented `options` schema is `seed`, `temperature`, `top_k`, `top_p`, `min_p`, `stop`, `num_ctx`, `num_predict`. `num_ctx` is deliberately not sent: no truncation was observed to 25k prompt tokens.

- [ ] **Step 1: Write the failing test**

Append to `packages/llm-unified/src/adapters/ollama-native.test.ts`:

```ts
describe('ollamaNativeAdapter mapSampling', () => {
  const adapter = ollamaNativeAdapter('glm-5.2:cloud', {
    vision: false,
    reasoning: { mode: 'fixed-on' },
  });

  it('nests temperature and renames max_tokens to num_predict', () => {
    // Ollama reads sampling ONLY under `options`; top-level keys are silently
    // ignored (measured 2026-07-17), which is why this rename is load-bearing.
    expect(adapter.mapSampling?.({ temperature: 0.3, max_tokens: 256 })).toEqual({
      options: { temperature: 0.3, num_predict: 256 },
    });
  });

  it('passes through the other documented options fields', () => {
    expect(adapter.mapSampling?.({ top_p: 0.9, seed: 42, stop: ['\n\n'] })).toEqual({
      options: { top_p: 0.9, seed: 42, stop: ['\n\n'] },
    });
  });

  it('drops keys ollama does not accept rather than sending them top-level', () => {
    expect(adapter.mapSampling?.({ frequency_penalty: 1, presence_penalty: 1 })).toEqual({});
  });

  it('returns an empty fragment for empty sampling', () => {
    expect(adapter.mapSampling?.({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run from `packages/llm-unified`: `bun test src/adapters/ollama-native.test.ts -t mapSampling`
Expected: FAIL — `adapter.mapSampling` is `undefined`, so `toEqual` receives `undefined`.

- [ ] **Step 3: Add the hook to the contract**

In `packages/llm-unified/src/adapter-contract.ts`, inside `interface ModelAdapter`, after `parseChunk`:

```ts
  /**
   * Translate canonical OpenAI-shaped sampling params (`temperature`,
   * `max_tokens`, …) into this provider's wire form, returning a body fragment
   * to merge. Absent → the params are spread as top-level keys, which is
   * correct for every OpenAI-compatible provider. Implement it only when the
   * upstream wants them elsewhere (ollama nests them under `options`).
   */
  mapSampling?(sampling: Record<string, unknown>): Record<string, unknown>;
```

- [ ] **Step 4: Implement it in the ollama adapter**

In `packages/llm-unified/src/adapters/ollama-native.ts`, add to the object returned by `ollamaNativeAdapter`, after `responseFraming: 'ndjson',`:

```ts
    mapSampling(sampling: Record<string, unknown>): Record<string, unknown> {
      // ollama reads sampling ONLY under `options` — top-level keys are accepted
      // and silently ignored (an out-of-range `options.temperature` 400s, the
      // same value top-level does not). Fields per ollama's documented
      // ModelOptions schema. `num_ctx` is omitted deliberately: ollama.com
      // applies no small default (no truncation measured to 25k prompt tokens).
      const options: Record<string, unknown> = {};
      if ('temperature' in sampling) options.temperature = sampling.temperature;
      if ('max_tokens' in sampling) options.num_predict = sampling.max_tokens;
      if ('top_p' in sampling) options.top_p = sampling.top_p;
      if ('seed' in sampling) options.seed = sampling.seed;
      if ('stop' in sampling) options.stop = sampling.stop;
      return Object.keys(options).length > 0 ? { options } : {};
    },
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `bun test src/adapters/ollama-native.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/src/adapter-contract.ts packages/llm-unified/src/adapters/ollama-native.ts packages/llm-unified/src/adapters/ollama-native.test.ts
git commit -m "Add mapSampling hook and nest ollama sampling under options"
```

---

### Task 2: `composeWire` honours `mapSampling` and is exported

**Files:**
- Modify: `packages/llm-unified/src/stream-completion.ts:180-218`
- Test: `packages/llm-unified/src/stream-completion.test.ts`

**Interfaces:**
- Consumes: `ModelAdapter.mapSampling` (Task 1).
- Produces: `export function composeWire(args: StreamCompletionArgs, adapter: ModelAdapter): { body: Record<string, unknown>; headers?: Record<string, string>; path?: string }` — used by Task 5.

**Context:** `buildWire` currently spreads sampling as top-level keys **outside** the adapter (`stream-completion.ts:196`), which is why ollama never sees it. Verification obligation §7.3 of the spec: with empty sampling the composed body must stay byte-identical for every existing adapter, or every provider record is invalidated at once.

- [ ] **Step 1: Write the failing tests**

Append to `packages/llm-unified/src/stream-completion.test.ts`:

```ts
import { composeWire } from './stream-completion.js';

describe('composeWire sampling', () => {
  const base = {
    provider: { id: 'ollama-cloud' },
    providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } },
    apiKey: 'k',
    target: { slug: 'glm-5.2:cloud', adapterId: 'x' },
    messages: [{ role: 'user' as const, content: 'hi' }],
  };

  it('uses the adapter mapSampling fragment instead of a top-level spread', () => {
    const adapter = {
      profile: {} as never,
      buildRequest: () => ({ model: 'm', body: { model: 'm', stream: true } }),
      parseChunk: () => ({ events: [], state: {} }),
      mapSampling: (s: Record<string, unknown>) => ({ options: { num_predict: s.max_tokens } }),
    };
    const wire = composeWire(
      { ...base, bodyExtras: { max_tokens: 8, reasoning: { enabled: false } } } as never,
      adapter as never,
    );
    expect(wire.body.options).toEqual({ num_predict: 8 });
    expect(wire.body.max_tokens).toBeUndefined();
  });

  it('spreads sampling top-level when the adapter has no mapSampling', () => {
    const adapter = {
      profile: {} as never,
      buildRequest: () => ({ model: 'm', body: { model: 'm', stream: true } }),
      parseChunk: () => ({ events: [], state: {} }),
    };
    const wire = composeWire(
      { ...base, bodyExtras: { temperature: 0.3, reasoning: { enabled: false } } } as never,
      adapter as never,
    );
    expect(wire.body.temperature).toBe(0.3);
  });

  it('lets adapter structural keys win over sampling on a clash', () => {
    const adapter = {
      profile: {} as never,
      buildRequest: () => ({ model: 'adapter-model', body: { model: 'adapter-model' } }),
      parseChunk: () => ({ events: [], state: {} }),
    };
    const wire = composeWire(
      { ...base, bodyExtras: { model: 'sampling-model', reasoning: { enabled: false } } } as never,
      adapter as never,
    );
    expect(wire.body.model).toBe('adapter-model');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `bun test src/stream-completion.test.ts -t composeWire`
Expected: FAIL — `composeWire` is not exported (import error).

- [ ] **Step 3: Rename and export, honouring the hook**

In `packages/llm-unified/src/stream-completion.ts`, replace the `buildWire` function (lines 180-197) with:

```ts
/**
 * Build the wire body AND any adapter-supplied headers via a ModelAdapter. The
 * adapter owns model/messages/stream/reasoning/tools and its own headers (e.g.
 * wafer's `Wafer-ZDR: required`).
 *
 * Sampling params (temperature, max_tokens, …) are OpenAI-shaped top-level keys
 * by default, which is correct for every OpenAI-compatible provider. An adapter
 * whose upstream wants them elsewhere implements `mapSampling` and owns the
 * translation — otherwise the params are sent in a shape the upstream silently
 * ignores (ollama's `options`; measured 2026-07-17).
 *
 * Shared with the conversation-suite's live binding so the harness verifies the
 * composition production uses rather than reimplementing it.
 */
export function composeWire(
  args: StreamCompletionArgs,
  adapter: ModelAdapter,
): { body: Record<string, unknown>; headers?: Record<string, string>; path?: string } {
  const { thinking: _thinking, reasoning: rawReasoning, ...sampling } = args.bodyExtras;
  const intent = (rawReasoning as ReasoningIntent | undefined) ?? { enabled: false };
  const req: CanonicalRequest = {
    messages: args.messages,
    reasoning: intent,
    ...(args.tools && args.tools.length > 0 ? { tools: args.tools } : {}),
    ...(args.cacheKey ? { cacheKey: args.cacheKey } : {}),
  };
  const wire = adapter.buildRequest(req);
  const mapped = adapter.mapSampling ? adapter.mapSampling(sampling) : sampling;
  // Sampling first, adapter body second: the adapter's structural keys
  // (model/messages/stream/reasoning/tools) always win on any clash, while
  // sampling params the adapter does not set survive.
  return { body: { ...mapped, ...wire.body }, headers: wire.headers, path: wire.path };
}
```

- [ ] **Step 4: Update the two internal callers**

In the same file, replace the body of `buildAdapterBody` (line 204) and the `buildWire(args, adapter)` call at line 72 so both use the new name:

```ts
  // line 72 area
  if (adapter) {
    const wire = composeWire(args, adapter);
```

```ts
/** The wire body via a ModelAdapter (headers dropped). Retained for tests. */
function buildAdapterBody(
  args: StreamCompletionArgs,
  adapter: ModelAdapter,
): Record<string, unknown> {
  return composeWire(args, adapter).body;
}
```

And in `_buildWireForTests`:

```ts
/** Test hook — exposes composeWire so cacheKey/header threading can be asserted. */
export function _buildWireForTests(args: StreamCompletionArgs, adapter: ModelAdapter) {
  return composeWire(args, adapter);
}
```

- [ ] **Step 5: Run the full package test suite**

Run: `bun test src/`
Expected: PASS. **The pre-existing `stream-completion` and adapter tests must be green unchanged** — that is the byte-identity check from spec §7.3. If any body-shape assertion changes, STOP and report: it means `composeWire` altered a working provider's wire.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/stream-completion.test.ts
git commit -m "Share composeWire and let adapters own sampling translation"
```

---

### Task 3: `operation` label and `UpstreamHttpError`

**Files:**
- Modify: `packages/llm-unified/src/stream-completion.ts:20-52, 82-120`
- Modify: `packages/llm-unified/src/index.ts:71`
- Test: `packages/llm-unified/src/stream-completion.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `StreamCompletionArgs.operation?: string` — retry-event label, default `'stream-completion'`. Task 4 passes `'one-shot'`.
  - `export class UpstreamHttpError extends Error { readonly status: number; readonly retryAfter: number | null }` — Task 4 relies on `.status` surviving.

**Context:** `classifyMemoryActionError` (`apps/user-client/src/memory/classify-error.ts:21-22`) reads `e.status` and maps 429/500/502/503/504 to `'upstream-busy'`. `stream-completion.ts:116` throws a bare `Error`, so without this the one-shot reroute degrades every memory error to `'failed'` — a user-visible regression.

- [ ] **Step 1: Write the failing tests**

Append to `packages/llm-unified/src/stream-completion.test.ts`:

`streamCompletion` takes **no** fetch injection; this file's tests swap
`globalThis.fetch` and restore it (see `stream-completion.test.ts:44-58`). Follow
that pattern exactly — do **not** add an injection point for a test. Use a
non-retryable status so the retry loop does not slow the test, mirroring the
existing "non-ok response throws (non-retryable 401)" test at line 130.

```ts
import { UpstreamHttpError } from './stream-completion.js';

describe('streamCompletion error surface', () => {
  it('throws UpstreamHttpError carrying the status so callers can classify it', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response('nope', { status: 401, headers: { 'retry-after': '2' } }),
    ) as unknown as typeof fetch;
    try {
      const iter = streamCompletion({
        provider: { id: 'ollama-cloud' },
        providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } },
        apiKey: 'k',
        target: { slug: 'glm-5.2:cloud' },
        messages: [{ role: 'user', content: 'hi' }],
        bodyExtras: {},
      } as never);
      const run = (async () => {
        for await (const _ of iter);
      })();
      await expect(run).rejects.toBeInstanceOf(UpstreamHttpError);
      await expect(run).rejects.toMatchObject({ status: 401, retryAfter: 2 });
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});
```

> The existing test at line 130 asserts on the thrown message
> `streamCompletion: upstream 401`. `UpstreamHttpError` keeps that message
> verbatim, so it must stay green — if it goes red, you changed the message.

- [ ] **Step 2: Run and watch it fail**

Run: `bun test src/stream-completion.test.ts -t "UpstreamHttpError"`
Expected: FAIL — `UpstreamHttpError` is not exported.

- [ ] **Step 3: Define the error and the option**

In `packages/llm-unified/src/stream-completion.ts`, after the imports:

```ts
/**
 * A non-2xx upstream response. Carries `status` because callers classify on it —
 * `classifyMemoryActionError` maps 429/5xx to the user-facing "upstream busy"
 * copy, and a bare Error would silently degrade that to a generic failure.
 */
export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;
  constructor(status: number, retryAfter: number | null) {
    super(`streamCompletion: upstream ${status}`);
    this.name = 'UpstreamHttpError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
```

Add to `interface StreamCompletionArgs`, after `onRetry`:

```ts
  /**
   * Retry-event label, surfaced to `onRetry` sinks. Defaults to
   * 'stream-completion'; background jobs pass 'one-shot' so their retry lines
   * stay distinguishable in the console.
   */
  operation?: string;
```

- [ ] **Step 4: Use both**

Import `parseRetryAfter` from `./retry.js` (extend the existing import on line 9), then in `streamCompletion`, replace line 93:

```ts
    operation: args.operation ?? 'stream-completion',
```

and replace lines 115-117:

```ts
  if (!response.ok) {
    const retryAfter = parseRetryAfter(response.headers);
    await response.body?.cancel().catch(() => {});
    throw new UpstreamHttpError(response.status, retryAfter);
  }
```

- [ ] **Step 5: Export it**

In `packages/llm-unified/src/index.ts`, replace line 71:

```ts
export {
  streamCompletion,
  composeWire,
  UpstreamHttpError,
  type StreamCompletionArgs,
} from './stream-completion.js';
```

- [ ] **Step 6: Run tests, typecheck, commit**

```bash
bun test src/
pnpm typecheck
git add packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/stream-completion.test.ts packages/llm-unified/src/index.ts
git commit -m "Surface upstream status and an operation label from streamCompletion"
```

---

### Task 4: Reroute `runOneShotCompletion` through `streamCompletion`

**Files:**
- Modify: `packages/llm-unified/src/one-shot-completion.ts` (delete lines 50-101 and 107-196, rewrite)
- Test: `packages/llm-unified/src/one-shot-completion.test.ts` (rewrite)

**Interfaces:**
- Consumes: `streamCompletion`, `UpstreamHttpError`, `StreamCompletionArgs.operation` (Task 3); `composeWire` indirectly (Task 2).
- Produces: `runOneShotCompletion(args: OneShotArgs): Promise<string>` — **signature unchanged**. `OneShotArgs` and `OneShotRawResponse` keep their current shape. `runOneShotCompletionWithSleep` is **removed**.

**Context:** This is the fix. Read spec §3 Fault A/B and §5.3 first.

- [ ] **Step 1: Verify the retry cases are covered elsewhere BEFORE deleting them**

Spec §7.2 — a verification obligation, not a formality. You are about to delete
four regression tests (429 retry, 401 no-retry, retries exhausted, fresh Request
per attempt), including one that was expensive to find once already. Deleting
them is only safe if `withStreamingRetry` covers the same ground.

```bash
rg -n "it\(" packages/llm-unified/src/retry.test.ts
```

Already confirmed present (2026-07-17): `retry.test.ts:341` "401 +
onUnauthorised(true) retries immediately", `retry.test.ts:349` "does not retry on
non-retryable status codes (401)", `retry.test.ts:359` "onUnauthorised fires at
most once". **Still to confirm yourself:** retry on a retryable status (429/503),
retries exhausted, and a fresh Request per attempt.

**If any of those three is missing, add it to `retry.test.ts` in this task**
before deleting the one-shot equivalent. Report what you found either way — "I
checked and they are covered" is a finding; silence is not.

- [ ] **Step 2: Write the new failing tests**

Replace the contents of `packages/llm-unified/src/one-shot-completion.test.ts` with tests for what one-shot now owns — the fold, `onRawResponse`, the empty guard, and that it neither sends tools nor a cacheKey. Mock `streamCompletion` via the injected `streamFn` added in Step 3:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { _runOneShotWith, runOneShotCompletion } from './one-shot-completion.js';
import type { StreamChunk } from './types.js';

const baseArgs = {
  provider: { id: 'ollama-cloud' } as never,
  providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } } as never,
  apiKey: 'k',
  target: { slug: 'glm-5.2:cloud', adapterId: 'ollama-cloud:glm-5.2:cloud' },
  messages: [{ role: 'user' as const, content: 'hi' }],
  bodyExtras: { temperature: 0.3, max_tokens: 256, reasoning: { enabled: false } },
};

function streamOf(chunks: StreamChunk[]) {
  return async function* () {
    for (const c of chunks) yield c;
  };
}

describe('runOneShotCompletion', () => {
  it('folds token chunks into the returned content', async () => {
    const result = await _runOneShotWith(
      baseArgs as never,
      streamOf([
        { type: 'token', text: 'Sorting ' },
        { type: 'token', text: 'lists' },
        { type: 'finish', reason: 'stop' },
      ]) as never,
    );
    expect(result).toBe('Sorting lists');
  });

  it('reports content, reasoning and finishReason through onRawResponse', async () => {
    let raw: unknown = null;
    await _runOneShotWith(
      { ...baseArgs, onRawResponse: (r: unknown) => { raw = r; } } as never,
      streamOf([
        { type: 'reasoning', text: 'thinking…' },
        { type: 'token', text: 'answer' },
        { type: 'finish', reason: 'stop' },
      ]) as never,
    );
    expect(raw).toEqual({ content: 'answer', reasoning: 'thinking…', finishReason: 'stop' });
  });

  it('fires onRawResponse BEFORE throwing on empty content (reasoning-only case)', async () => {
    let raw: unknown = null;
    const p = _runOneShotWith(
      { ...baseArgs, onRawResponse: (r: unknown) => { raw = r; } } as never,
      streamOf([{ type: 'reasoning', text: 'only thinking' }]) as never,
    );
    await expect(p).rejects.toThrow('one-shot returned empty content');
    expect(raw).toEqual({ content: '', reasoning: 'only thinking', finishReason: null });
  });

  it('sends neither tools nor a cacheKey', async () => {
    let seen: Record<string, unknown> = {};
    await _runOneShotWith(
      baseArgs as never,
      ((a: Record<string, unknown>) => {
        seen = a;
        return streamOf([{ type: 'token', text: 'x' }])();
      }) as never,
    );
    expect(seen.tools).toBeUndefined();
    expect(seen.cacheKey).toBeUndefined();
    expect(seen.operation).toBe('one-shot');
  });

  it('is exported with an unchanged public signature', () => {
    expect(typeof runOneShotCompletion).toBe('function');
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `bun test src/one-shot-completion.test.ts`
Expected: FAIL — `_runOneShotWith` is not exported.

- [ ] **Step 4: Rewrite the implementation**

Replace everything in `packages/llm-unified/src/one-shot-completion.ts` **below the `OneShotArgs` interface** (i.e. delete `OneShotResponse`, `composeOneShotWire`, `runOneShotCompletionWithSleep` and the old `runOneShotCompletion`) with:

```ts
const DEFAULT_ONE_SHOT_TIMEOUT_MS = 30_000;

/**
 * Non-streaming completion for background jobs (title generation, memory
 * extraction, compaction, vision substitution). A thin fold over
 * `streamCompletion`: it is the ONLY wire path, so background jobs automatically
 * inherit every adapter hook — endpoint path, response framing, sampling
 * translation, headers. A parallel implementation drifted from those hooks once
 * already and 404'd every Ollama background job (see the 2026-07-17 spec).
 */
export async function runOneShotCompletion(args: OneShotArgs): Promise<string> {
  return _runOneShotWith(args, streamCompletion);
}

/** Internal seam for tests: injects the stream producer. Not part of the public API. */
export async function _runOneShotWith(
  args: OneShotArgs,
  streamFn: typeof streamCompletion,
): Promise<string> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_ONE_SHOT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;

  // No `cacheKey` and no `tools` by design: one-shot calls forgo
  // conversation-affinity caching (spec §6 — chat-only) and never call tools.
  // `initialResponseTimeoutMs` is the caller's overall budget, NOT the 15 s
  // streaming default: dreaming (180 s, 40-memory batches) and compaction have
  // no time-to-first-byte constraint today, and inheriting one would break them.
  for await (const chunk of streamFn({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    target: args.target,
    messages: args.messages,
    bodyExtras: args.bodyExtras,
    signal,
    initialResponseTimeoutMs: timeoutMs,
    operation: 'one-shot',
    onRetry: args.onRetry,
  })) {
    if (chunk.type === 'token') content += chunk.text;
    else if (chunk.type === 'reasoning') reasoning += chunk.text;
    else if (chunk.type === 'finish') finishReason = chunk.reason;
  }

  args.onRawResponse?.({ content, reasoning, finishReason });
  if (content.length === 0) throw new Error('one-shot returned empty content');
  return content;
}
```

Fix the imports at the top of the file: remove `applyReasoningToBody`, `ProviderId`, `CanonicalRequest`, `getAdapter`, `fetchWithProxyAuth`, `buildRequest`, `OnRetry`-adjacent retry helpers (`parseRetryAfter`, `shouldRetryStatus`, `withRetry`) and `ReasoningIntent` if now unused; add `import { streamCompletion } from './stream-completion.js';`. Keep `OnRetry` — `OneShotArgs.onRetry` still uses it. Let `pnpm typecheck` tell you exactly which imports are dead.

- [ ] **Step 5: Run the tests**

Run: `bun test src/one-shot-completion.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Close the proxy-401 verification obligation**

Spec §7.1 — one-shot previously refreshed the proxy token via `fetchWithProxyAuth`;
it now inherits `withStreamingRetry`'s `onUnauthorised`. `proxy-auth.ts:21-26`
names memory extraction as a common trigger, so this path is live.

Already established, do not re-litigate: the refresh **mechanism** is covered in
`retry.test.ts:341` ("401 + onUnauthorised(true) retries immediately without
consuming a retry") and `retry.test.ts:359` ("onUnauthorised fires at most once").
What is **not** established is the **wiring** — that `streamCompletion` passes
`onUnauthorised` only when `providerConfig.routing.kind === 'cors-proxy'`
(`stream-completion.ts:97-102`).

Check for that wiring test:

```bash
rg -n "cors-proxy" packages/llm-unified/src/stream-completion.test.ts
```

If absent, add it to `stream-completion.test.ts` (not the one-shot file — it is
`streamCompletion`'s wiring): set a `ProxyAuthSource` via `setProxyAuthSource`
from `./proxy-auth.js` whose `refreshToken` increments a counter, swap
`globalThis.fetch` to return 401 then 200, run `streamCompletion` with
`routing: { kind: 'cors-proxy', … }`, and assert `refreshToken` was called
exactly once. Restore both the fetch and the auth source (`setProxyAuthSource(null)`)
in a `finally`.

One-shot itself needs **no** test here: it adds no logic on this path, it only
delegates. Say so in the commit message.

- [ ] **Step 7: Full package tests, typecheck, commit**

```bash
bun test src/
pnpm typecheck
git add packages/llm-unified/src/one-shot-completion.ts packages/llm-unified/src/one-shot-completion.test.ts
git commit -m "Route one-shot completions through streamCompletion"
```

---

### Task 5: The suite binding shares `composeWire`

**Files:**
- Modify: `packages/llm-unified/curation/conversation-suite/binding.ts:19-77`
- Test: `packages/llm-unified/curation/conversation-suite/binding.test.ts`

**Interfaces:**
- Consumes: `composeWire` (Task 2).
- Produces: `LiveBindingArgs.sampling?: Record<string, unknown>` — Task 6 passes `{ max_tokens: N }`.

**Context:** `binding.ts:45-60` composes the wire itself and sends **no sampling at all** — half the reason the sampling leak survived onboarding (spec §3). The binding keeps its own `fetch` (it must capture the HTTP status rather than throw); only composition is shared.

- [ ] **Step 1: Write the failing test**

Append to `packages/llm-unified/curation/conversation-suite/binding.test.ts`:

```ts
it('routes sampling through the adapter mapSampling rather than sending it top-level', async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl = (async (req: Request) => {
    sentBody = await req.json();
    return new Response('{"done":true}\n', { status: 200 });
  }) as unknown as typeof fetch;

  const binding = makeLiveBinding({
    offeringRef: 'ollama-cloud:glm-5.2:cloud',
    providerConfig: { baseUrl: 'https://ollama.com', routing: { kind: 'direct' } },
    apiKey: 'k',
    adapter: ollamaNativeAdapter('glm-5.2:cloud', {
      vision: false,
      reasoning: { mode: 'fixed-on' },
    }),
    sampling: { max_tokens: 8 },
    fetchImpl,
  });
  await binding.runTurn([{ role: 'user', content: 'hi' }], { enabled: false });

  expect(sentBody.options).toEqual({ num_predict: 8 });
  expect(sentBody.max_tokens).toBeUndefined();
});
```

Import `ollamaNativeAdapter` from `'../../src/adapters/ollama-native.js'` at the top of the test file.

- [ ] **Step 2: Run and watch it fail**

Run: `bun test curation/conversation-suite/binding.test.ts -t mapSampling`
Expected: FAIL — `sampling` is not a `LiveBindingArgs` field; `options` is undefined on the sent body.

- [ ] **Step 3: Add the field**

In `packages/llm-unified/curation/conversation-suite/binding.ts`, add to `interface LiveBindingArgs` after `tools`:

```ts
  /**
   * Sampling params in canonical OpenAI shape (e.g. `{ max_tokens: 8 }`),
   * translated by the adapter's `mapSampling`. The suite sent none until
   * 2026-07-17, which is why a provider silently ignoring a cap went unseen.
   */
  sampling?: Record<string, unknown>;
```

- [ ] **Step 4: Use `composeWire` instead of composing by hand**

Replace lines 45-60 of `binding.ts` (the `const wire = args.adapter.buildRequest({...})` block and the `buildRequest({...})` inside `withStreamingRetry`) with:

```ts
      // Share the production composer so the harness verifies the pipe production
      // uses rather than a reimplementation of it. The fetch stays ours: the
      // suite must capture a non-2xx status as a checkable outcome, not an
      // exception (the MiMo/chutes 400 case).
      const wire = composeWire(
        {
          provider: { id: 'suite' },
          providerConfig: args.providerConfig,
          apiKey: args.apiKey,
          target: { slug: '', adapterId: args.offeringRef },
          messages,
          bodyExtras: { ...(args.sampling ?? {}), reasoning },
          tools: args.tools,
        } as unknown as StreamCompletionArgs,
        args.adapter,
      );

      const response = await withStreamingRetry({
        buildRequest: () =>
          buildRequest({
            provider: args.providerConfig,
            apiKey: args.apiKey,
            path: wire.path ?? '/chat/completions',
            method: 'POST',
            body: wire.body,
            extraHeaders: wire.headers,
          }),
```

Add the imports at the top of `binding.ts`:

```ts
import { type StreamCompletionArgs, composeWire } from '../../src/stream-completion.js';
```

> **Why the `as unknown as StreamCompletionArgs` cast:** `composeWire` only reads
> `messages`, `bodyExtras`, `tools` and `cacheKey`; the transport fields are
> irrelevant to composition. Keep the cast local and commented — do not widen
> `composeWire`'s signature to accommodate the suite.

- [ ] **Step 5: Run the binding tests**

Run: `bun test curation/conversation-suite/`
Expected: PASS. **Every pre-existing binding test must stay green unchanged** — with no `sampling`, `composeWire` must produce exactly today's body (spec §7.3). If one goes red, STOP and report.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/curation/conversation-suite/binding.ts packages/llm-unified/curation/conversation-suite/binding.test.ts
git commit -m "Share the production wire composer with the suite binding"
```

---

### Task 6: `assertUsageWithinCap` and the sampling-cap turn

**Files:**
- Modify: `packages/llm-unified/curation/conversation-suite/assertions.ts`
- Modify: `packages/llm-unified/curation/conversation-suite/scenarios/core.ts`
- Modify: `packages/llm-unified/curation/conversation-suite/index.ts`
- Modify: `packages/llm-unified/curation/run-ollama-suite.ts`
- Test: `packages/llm-unified/curation/conversation-suite/assertions.test.ts`

**Interfaces:**
- Consumes: `LiveBindingArgs.sampling` (Task 5); `TurnOutcome` (`types.ts:5-20`).
- Produces: `assertUsageWithinCap(maxTokens: number): Assertion`, `assertTextPresent(outcome: TurnOutcome): AssertionResult`.

**Context:** This is the assertion with teeth — it would have caught the sampling leak at onboarding (`eval_count: 120` against `max_tokens: 8`).

- [ ] **Step 1: Write the failing test**

Append to `packages/llm-unified/curation/conversation-suite/assertions.test.ts`:

```ts
import { assertTextPresent, assertUsageWithinCap } from './assertions.js';

const outcome = (usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null, text = 'x') => ({
  httpStatus: 200,
  chunks: [],
  text,
  reasoning: '',
  toolCalls: [],
  usage,
  finishReason: 'stop',
});

describe('assertUsageWithinCap', () => {
  it('passes when the model honoured the cap', () => {
    const r = assertUsageWithinCap(8)(outcome({ promptTokens: 5, completionTokens: 8, totalTokens: 13 }) as never);
    expect(r.status).toBe('pass');
  });

  it('fails when the cap was ignored — the ollama sampling leak', () => {
    const r = assertUsageWithinCap(8)(outcome({ promptTokens: 5, completionTokens: 120, totalTokens: 125 }) as never);
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('120');
  });

  it('fails when usage is absent, since the cap cannot be verified', () => {
    const r = assertUsageWithinCap(8)(outcome(null) as never);
    expect(r.status).toBe('fail');
  });
});

describe('assertTextPresent', () => {
  it('fails on empty text', () => {
    expect(assertTextPresent(outcome(null, '') as never).status).toBe('fail');
  });
  it('passes on non-empty text', () => {
    expect(assertTextPresent(outcome(null, 'hi') as never).status).toBe('pass');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test curation/conversation-suite/assertions.test.ts`
Expected: FAIL — neither assertion is exported.

- [ ] **Step 3: Implement the assertions**

Append to `packages/llm-unified/curation/conversation-suite/assertions.ts`:

```ts
/**
 * The model's completion stayed within the requested token cap — i.e. the cap
 * actually reached the upstream. A provider that reads sampling from a different
 * place silently ignores an OpenAI-shaped cap and overruns it; ollama did
 * exactly this until 2026-07-17 (`eval_count: 120` against `max_tokens: 8`).
 * Usage-absent is a fail: an unverifiable cap is not a passed cap.
 */
export function assertUsageWithinCap(maxTokens: number): Assertion {
  return (outcome) => {
    if (outcome.usage === null) {
      return {
        assertion: `usage-within-cap:${maxTokens}`,
        status: 'fail',
        detail: 'no usage surfaced, so the cap cannot be verified',
      };
    }
    const used = outcome.usage.completionTokens;
    const ok = used <= maxTokens;
    return {
      assertion: `usage-within-cap:${maxTokens}`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `${used} completion tokens within the ${maxTokens} cap`
        : `${used} completion tokens exceed the ${maxTokens} cap (the cap never reached the upstream)`,
    };
  };
}

/** The turn produced visible text at all. */
export function assertTextPresent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.text.trim().length > 0;
  return {
    assertion: 'text-present',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `${outcome.text.length} chars` : 'no text returned',
  };
}
```

- [ ] **Step 4: Add the scenario turn**

In `packages/llm-unified/curation/conversation-suite/scenarios/core.ts`, add `assertUsageWithinCap` to the import from `'../assertions.js'`, then append this turn to `coreScenario.turns`:

```ts
    {
      // The sampling-cap probe. It verifies the CAP ARRIVED, not that the model
      // is terse: a provider reading sampling from a different place (ollama's
      // `options`) silently ignores an OpenAI-shaped cap and overruns it. The
      // cap itself is supplied by the binding's `sampling`, so this turn is only
      // meaningful when the binding sets `max_tokens: 16`.
      id: 'sampling-cap',
      send: [{ role: 'user', content: 'Count from 1 to 40, separated by commas.' }],
      assertions: [assertNoHttpError, assertUsagePresent, assertUsageWithinCap(16)],
    },
```

- [ ] **Step 5: Confirm the exports need no change**

`index.ts:4` is `export * from './assertions.js'`, so both new assertions are
already re-exported. **No edit needed** — verify with:

```bash
rg -n "assertions.js" packages/llm-unified/curation/conversation-suite/index.ts
```

Expected: `export * from './assertions.js';`. If that is what you see, move on.

- [ ] **Step 6: Wire the cap into the ollama runner**

In `packages/llm-unified/curation/run-ollama-suite.ts`, add to the `makeLiveBinding({...})` call (after `tools,`):

```ts
    // The cap the `sampling-cap` turn asserts. 16 is small enough that any
    // provider ignoring it overruns unmistakably.
    sampling: { max_tokens: 16 },
```

- [ ] **Step 7: Run tests, typecheck, commit**

```bash
bun test curation/
pnpm typecheck
git add packages/llm-unified/curation/
git commit -m "Assert the token cap actually reaches the upstream"
```

---

### Task 7: One-shot coverage in the suite

**Files:**
- Modify: `packages/llm-unified/curation/conversation-suite/binding.ts`
- Modify: `packages/llm-unified/curation/conversation-suite/index.ts`
- Create: `packages/llm-unified/curation/conversation-suite/scenarios/one-shot.ts`
- Modify: `packages/llm-unified/curation/run-ollama-suite.ts`

**Interfaces:**
- Consumes: `runOneShotCompletion` (Task 4); `UpstreamHttpError` (Task 3); `assertTextPresent` (Task 6).
- Produces: `makeOneShotBinding(args: OneShotBindingArgs): RunnerBinding`; `oneShotScenario: ConversationScenario`.

**Context:** See the deviation note at the top of this plan — this replaces the spec's `RunnerBinding.runOneShot?`, which could never execute. This turn is thin insurance: it encodes that the suite must touch the **background-job entry point**, not only the chat entry point. It cannot assert usage — `runOneShotCompletion` returns only a string.

- [ ] **Step 1: Create the scenario**

Create `packages/llm-unified/curation/conversation-suite/scenarios/one-shot.ts`:

```ts
// SPDX-License-Identifier: LGPL-3.0-only
import { assertNoHttpError, assertTextPresent } from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * The background-job entry point (`runOneShotCompletion`) — the path title
 * generation, memory and compaction take. The core scenario only ever exercised
 * the chat entry point, which is why every Ollama background job could 404 while
 * the suite reported "core 11/11, verified" (2026-07-17). One turn, shaped like
 * real title generation.
 */
export const oneShotScenario: ConversationScenario = {
  id: 'one-shot',
  description: 'The non-streaming background-job path returns usable content.',
  turns: [
    {
      id: 'one-shot-title',
      send: [
        { role: 'system', content: 'Reply with a short chat title only. No preamble.' },
        { role: 'user', content: 'How do I sort a list in Python?' },
      ],
      assertions: [assertNoHttpError, assertTextPresent],
    },
  ],
};
```

- [ ] **Step 2: Add the binding factory**

Append to `packages/llm-unified/curation/conversation-suite/binding.ts`:

```ts
export interface OneShotBindingArgs {
  offeringRef: string;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  target: CompletionTarget;
  sampling?: Record<string, unknown>;
  onRetry?: OnRetry;
}

/**
 * Wire the suite to the BACKGROUND-JOB path (`runOneShotCompletion`) rather than
 * the chat path. Mirrors what title generation sends. A non-2xx becomes a
 * checkable outcome (like `makeLiveBinding`), not an exception, by unwrapping
 * `UpstreamHttpError`.
 */
export function makeOneShotBinding(args: OneShotBindingArgs): RunnerBinding {
  return {
    offeringRef: args.offeringRef,
    async runTurn(messages, reasoning) {
      try {
        const text = await runOneShotCompletion({
          provider: args.provider,
          providerConfig: args.providerConfig,
          apiKey: args.apiKey,
          target: args.target,
          messages,
          bodyExtras: { ...(args.sampling ?? {}), reasoning },
          onRetry: args.onRetry ?? logRetryToConsole,
        });
        return { ...assembleOutcome(200, []), text };
      } catch (e) {
        const status = e instanceof UpstreamHttpError ? e.status : 0;
        return assembleOutcome(status, []);
      }
    },
    toolResultFor(call): ReturnType<RunnerBinding['toolResultFor']> {
      return {
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify({ ok: true }),
      };
    },
  };
}
```

Add the imports it needs at the top of `binding.ts`:

```ts
import type { CompletionTarget } from '../../src/catalogue/target.js';
import { runOneShotCompletion } from '../../src/one-shot-completion.js';
import { UpstreamHttpError } from '../../src/stream-completion.js';
```

> `assembleOutcome(200, [])` yields empty text; the spread sets `text` from the
> returned string. Usage stays null — one-shot does not surface it, which is why
> `oneShotScenario` asserts text, not usage.

- [ ] **Step 3: Export the scenario**

`index.ts:7` is `export * from './binding.js'`, so `makeOneShotBinding` is
already re-exported — no edit needed there. Scenarios are exported by name
(`index.ts:9-10`), so add one line after the `visionScenario` export:

```ts
export { oneShotScenario } from './scenarios/one-shot.js';
```

- [ ] **Step 4: Run it from the ollama runner**

In `packages/llm-unified/curation/run-ollama-suite.ts`, add `makeOneShotBinding` and `oneShotScenario` to the import from `'./conversation-suite/index.js'`, then inside the offering loop after the core run:

```ts
  // The background-job path — title generation, memory, compaction. Broken on
  // every ollama model until 2026-07-17 while core stayed green.
  const oneShot = await runSuite(
    oneShotScenario,
    [{ label: 'reasoning-off', intent: { enabled: false } }],
    makeOneShotBinding({
      offeringRef: `ollama-cloud:${o.upstreamSlug}`,
      provider: ollamaCloud,
      providerConfig,
      apiKey,
      target: { slug: o.upstreamSlug, adapterId: o.adapter.kind === 'catalogue' ? o.adapter.adapterId : undefined },
      sampling: { temperature: 0.3, max_tokens: 256 },
    }),
  );
  console.log(renderSuiteReport(oneShot));
```

> The adapter must be registered for `getAdapter(adapterId)` to resolve inside
> `streamCompletion`. Check whether `run-ollama-suite.ts` already triggers
> `registerOllamaCloud()` (via importing `ollamaCloud`); if not, import and call
> the registration from `src/providers/_register-builtins.js` before the loop.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add packages/llm-unified/curation/
git commit -m "Cover the background-job path in the conversation-suite"
```

---

### Task 8: Live verification and the Curation Record

**Files:**
- Modify: `obsidian/providers/ollama-cloud.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the honest record.

**Context:** Spec §8. This is the honesty surface — it currently states three things that are false.

- [ ] **Step 1: Run the live suite**

From `packages/llm-unified`, with `keys/.ollama-test-key` present:

```bash
bun run curation/run-ollama-suite.ts
```

Expected: every permutation green for `glm-5.1`, `glm-5.2:cloud` and `deepseek-v4-pro`, including `usage-within-cap:16` and the new `one-shot` scenario.

**If the runner errors on the two web offerings** (`web-ollama-search`, `web-ollama-fetch`): the loop at `run-ollama-suite.ts:51` iterates **all** offerings including web ones. That is a pre-existing bug, not yours. Report it; do not fix it here.

- [ ] **Step 2: Report the run verbatim**

Paste the actual report output. Do not summarise it as "all green" without the text. A claimed pass-rate that was not measured is worse than no claim.

- [ ] **Step 3: Update the Curation Record**

Rewrite these parts of `obsidian/providers/ollama-cloud.md`:

1. **"Why native `/api/chat`, not `/v1/chat/completions`"** — the current justification (the `/v1` shim re-calls the tool after a tool result) **no longer reproduces**: 18/18 answered across glm-5.1, glm-5.2:cloud and deepseek-v4-pro, with the real `buildPrompt` system prompt, streaming, 3 runs per cell (2026-07-17). Replace with the honest reasons: ollama's first-class API; atomic tool-call arguments (no SSE fragment reassembly); a dedicated reasoning channel; and — measured — the smallest adapter in the repo (160 lines vs 175-267 for the six OpenAI clones), so `/v1` would be net *more* code. Record that `/v1` is a measured-viable fallback.
2. **The `think:false` claim** (mirrored in `ollama-cloud.ts:67`): natively, `think:false` yields clean content and an **empty** thinking channel. On `/v1` it is `think` that is ignored and `reasoning_effort: 'none'` that works (halving completion tokens 481 → 222). Correct both the record and the code comment.
3. **The offerings table** — it lists 2 offerings; there are 3 (glm-5.1, glm-5.2, deepseek-v4-pro).
4. **"Live conversation-suite: both core 11/11"** — qualify it. It was true and simultaneously concealed three broken background jobs, because the suite never touched the one-shot path and never sent sampling.
5. **Add a "What was repaired (Mode 3, 2026-07-17)" section**: the 404 (adapter path discarded by one-shot), the OpenAI-envelope parse, and the sampling leak (`options` nesting), with the probe evidence.

- [ ] **Step 4: Commit the record**

```bash
git add obsidian/providers/ollama-cloud.md
git commit -m "Record the Ollama Cloud background-job repair [skip ci]"
```

---

## Hand back to Liz

Do **not** squash, merge or push — Liz owns integration. When Task 8 is done,
report:

1. The verbatim live-suite output (Task 8 Step 2).
2. What Step 1 of Task 4 found about retry coverage, and whether you added tests.
3. Whether any pre-existing test had to change (Task 2 Step 5, Task 5 Step 5). A
   changed body-shape assertion is a red flag, not a chore.

Liz then runs `pnpm typecheck --force` (Turbo caches typecheck; a test-only
change can get a cached pass), squashes the unit, and hands
[spec §10 Manual verification](../specs/2026-07-17-ollama-cloud-background-jobs-design.md#10-manual-verification-chris-on-device)
to Chris: real titles on GLM 5.2, GLM 5.1 and DeepSeek V4 Pro, memory extraction,
compaction, and the "upstream busy" error copy. Automated coverage does not
substitute for that — it is the only check that the reported bug is actually gone.

## Follow-ups discovered while planning (do NOT fix here)

Add to `obsidian/insights/follow-ups-index.md` in Task 8:

- **`run-ollama-suite.ts:51`** iterates all offerings including the two web ones, building an LLM adapter for `web-ollama-search` / `web-ollama-fetch`.
- **`run-ollama-suite.ts:4-8`** header comment claims ollama uses the generic path via `makeGenericLiveBinding`; the code uses `makeLiveBinding` with the native adapter.
- **`binding.ts:106`** documents `makeGenericLiveBinding` as serving "vanilla OpenAI-compatible providers (e.g. ollama-cloud)" — wrong since 2026-06-03.
- **GLM 5.2's `fixed-on` reasoning classification is probably wrong** — reasoning can be disabled on both endpoints. UX-visible; Chris's call.
- **A shared `openAiCompatAdapter`** for the six near-duplicate OpenAI adapters (1 321 lines between them).
