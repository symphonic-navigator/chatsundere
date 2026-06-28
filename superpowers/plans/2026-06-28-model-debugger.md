# Model Debugger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a self-service diagnostic that reproduces the real streaming path against a chosen model and produces a copyable, redacted report — surfaced both from each provider's settings page and from the in-chat failure footer.

**Architecture:** A diagnostic *sink* is threaded into the shared `streamCompletion` transport in `packages/llm-unified` (firing `onRequest`/`onResponse` with secrets redacted at source). A pure `model-debug.ts` in `apps/user-client` owns the report type, the timeline collector, the environment snapshot and the plain-text serialiser, plus a `runStreamingTest` orchestrator. Two thin React surfaces consume it: a `PickerOverlay`-based `ModelDebugOverlay` opened from `provider.tsx`, and a quiet "Show diagnostics" link added to `StreamInterruptedFooter`, fed by an in-memory report the stream-manager stores on failure.

**Tech Stack:** TypeScript (strict), Bun test (packages/llm-unified), Vitest + RTL (apps/user-client), React 18, Tailwind v4, Zustand, TanStack Query.

**Spec:** `superpowers/specs/2026-06-28-model-debugger-design.md` (read it first).

**Conventions:**
- British English everywhere (Hard Rule §3.7).
- New files in `packages/llm-unified` → `// SPDX-License-Identifier: LGPL-3.0-only`. New files in `apps/user-client` → `// SPDX-License-Identifier: AGPL-3.0-only`.
- llm-unified tests: co-located `src/*.test.ts`, run `bun test <file>`.
- user-client tests: under `apps/user-client/tests/...`, run `cd apps/user-client && pnpm exec vitest run <path>`.
- Commit after each task (free-form imperative subject; `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`). Do **not** push or switch branches (subagents never merge/push/switch — CLAUDE.md §13).
- Final gate before squash: `pnpm typecheck --force`, `pnpm build`, `pnpm --filter @chatsundere/user-client test`, `bun test` in llm-unified, Biome clean.

---

## File Structure

**Modify (packages/llm-unified):**
- `src/transport.ts` — add `StreamDiagnosticsSink` type + `redactRequestHeaders` / `pickResponseHeaders` helpers; `buildRequest` fires `onRequest`.
- `src/stream-completion.ts` — `StreamCompletionArgs` gains `onDiagnostics?`; fire `onResponse` after the retry harness returns.

**Create (apps/user-client):**
- `src/lib/model-debug.ts` — report types, `buildEnvironmentSnapshot`, `createDiagnosticsCollector`, `formatReport`, `runStreamingTest`. No React.
- `src/components/ModelDebugReport.tsx` — renders a `DiagnosticReport` (warm top line, sections, labelled reply, Copy report, what-next line).
- `src/components/ModelDebugOverlay.tsx` — `PickerOverlay` with a provider-scoped model list, Run/Stop, 60 s timeout, renders `ModelDebugReport`.

**Modify (apps/user-client):**
- `src/lib/stream-engine.ts` — `StartStreamArgs` gains `onDiagnostics?`; forward it into `streamCompletion`.
- `src/state/stream-manager.store.ts` — add `diagnostics: Map<string, DiagnosticReport>`; arm a per-send collector; clear on start; build+store report in the `.catch`.
- `src/routes/app/settings/provider.tsx` — add a gated "Test a model" button + the overlay.
- `src/components/chat/StreamInterruptedFooter.tsx` — optional `onShowDiagnostics` + perishable nudge + intent hierarchy.
- `src/routes/app/chat/chat-page.tsx` — read the diagnostics selector, wire `onShowDiagnostics` conditionally, render `ModelDebugReport` in an overlay.

**Test files:**
- `packages/llm-unified/src/transport-diagnostics.test.ts`
- `apps/user-client/tests/lib/model-debug.test.ts`
- `apps/user-client/tests/components/ModelDebugReport.test.tsx`
- `apps/user-client/tests/components/ModelDebugOverlay.test.tsx`
- `apps/user-client/tests/components/StreamInterruptedFooter.test.tsx`

---

## Task 1: Diagnostic sink + redaction in llm-unified transport

**Files:**
- Modify: `packages/llm-unified/src/transport.ts`
- Modify: `packages/llm-unified/src/stream-completion.ts`
- Test: `packages/llm-unified/src/transport-diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/llm-unified/src/transport-diagnostics.test.ts`:

```typescript
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import {
  buildRequest,
  pickResponseHeaders,
  redactRequestHeaders,
  type StreamDiagnosticsSink,
} from './transport.js';

describe('redactRequestHeaders', () => {
  test('drops secret-bearing headers entirely, keeps the rest', () => {
    const h = new Headers({
      Authorization: 'Bearer sk-supersecret',
      'x-api-key': 'sk-supersecret',
      'x-cors-proxy-api-key': 'proxy-secret',
      'Content-Type': 'application/json',
      'x-cors-proxy-target': 'https://api.example.com',
    });
    const out = redactRequestHeaders(h);
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('sk-supersecret');
    expect(serialised).not.toContain('proxy-secret');
    expect(out['content-type']).toBe('application/json');
    expect(out['x-cors-proxy-target']).toBe('https://api.example.com');
    expect('authorization' in out).toBe(false);
  });
});

describe('pickResponseHeaders', () => {
  test('allowlists diagnostic headers, drops everything else', () => {
    const h = new Headers({
      'content-type': 'text/event-stream',
      'content-encoding': 'gzip',
      'cf-ray': 'abc123',
      'set-cookie': 'session=leak',
      'x-internal': 'secret',
    });
    const out = pickResponseHeaders(h);
    expect(out['content-type']).toBe('text/event-stream');
    expect(out['content-encoding']).toBe('gzip');
    expect(out['cf-ray']).toBe('abc123');
    expect('set-cookie' in out).toBe(false);
    expect('x-internal' in out).toBe(false);
  });
});

describe('buildRequest onDiagnostics', () => {
  test('fires onRequest with the resolved url and redacted headers', () => {
    const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
    const sink: StreamDiagnosticsSink = {
      onRequest: (info) => seen.push(info),
      onResponse: () => {},
    };
    buildRequest({
      provider: { baseUrl: 'https://api.example.com', routing: { kind: 'direct' } },
      apiKey: 'sk-supersecret',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/chat/completions',
      method: 'POST',
      body: { model: 'm', messages: [] },
      onDiagnostics: sink,
    });
    expect(seen.length).toBe(1);
    expect(seen[0]?.url).toBe('https://api.example.com/chat/completions');
    expect(seen[0]?.method).toBe('POST');
    expect(JSON.stringify(seen[0]?.headers)).not.toContain('sk-supersecret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/llm-unified && bun test src/transport-diagnostics.test.ts`
Expected: FAIL — `redactRequestHeaders`, `pickResponseHeaders`, `StreamDiagnosticsSink`, and the `onDiagnostics` arg do not exist.

- [ ] **Step 3: Add the sink type + helpers to transport.ts**

In `packages/llm-unified/src/transport.ts`, add near the top (after the existing imports), and extend `BuildRequestArgs` with `onDiagnostics?`:

```typescript
/**
 * Optional capture sink threaded through the streaming transport so a debugger
 * (or the chat-failure path) can observe the resolved request and response
 * without re-implementing transport. Both header maps are sanitised at source:
 * request headers are denylist-redacted (no secret ever leaves the library),
 * response headers are allowlisted to the diagnostic-relevant set.
 */
export interface StreamDiagnosticsSink {
  onRequest(info: { method: string; url: string; headers: Record<string, string> }): void;
  onResponse(info: { status: number; statusText: string; headers: Record<string, string> }): void;
}

const SECRET_REQUEST_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'x-cors-proxy-api-key',
]);

/** Drop secret-bearing request headers entirely (no partial-key masking). */
export function redactRequestHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (SECRET_REQUEST_HEADERS.has(key.toLowerCase())) return;
    out[key.toLowerCase()] = value;
  });
  return out;
}

const ALLOWED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-encoding',
  'transfer-encoding',
  'cache-control',
  'server',
  'via',
  'cf-ray',
  'x-request-id',
  'retry-after',
  'date',
]);

/** Keep only the diagnostic-relevant response headers. */
export function pickResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (ALLOWED_RESPONSE_HEADERS.has(key.toLowerCase())) out[key.toLowerCase()] = value;
  });
  return out;
}
```

Then in `BuildRequestArgs` (the interface above `buildRequest`), add:

```typescript
  onDiagnostics?: StreamDiagnosticsSink;
```

And change the tail of `buildRequest` from `return new Request(...)` to capture the request, fire the hook, then return:

```typescript
  const request = new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  args.onDiagnostics?.onRequest({ method, url, headers: redactRequestHeaders(headers) });
  return request;
```

- [ ] **Step 4: Wire onResponse into stream-completion.ts**

In `packages/llm-unified/src/stream-completion.ts`:

Add to `StreamCompletionArgs` (after `onRetry?: OnRetry;`):

```typescript
  /** Optional diagnostic capture sink (debugger / chat-failure path). */
  onDiagnostics?: StreamDiagnosticsSink;
```

Import the type at the top alongside the existing transport import:

```typescript
import { buildRequest, type StreamDiagnosticsSink } from './transport.js';
```

(If `buildRequest` is already imported, just add `type StreamDiagnosticsSink` to that import.)

Pass the sink into the `buildRequest` call inside the `withStreamingRetry` thunk (add one line to the object):

```typescript
        onDiagnostics: args.onDiagnostics,
```

After the `const response = await withStreamingRetry({ ... });` call returns and before the `if (!response.ok)` check, add:

```typescript
  args.onDiagnostics?.onResponse({
    status: response.status,
    statusText: response.statusText,
    headers: pickResponseHeaders(response.headers),
  });
```

Add `pickResponseHeaders` to the transport import:

```typescript
import { buildRequest, pickResponseHeaders, type StreamDiagnosticsSink } from './transport.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/llm-unified && bun test src/transport-diagnostics.test.ts`
Expected: PASS (3 describe blocks green).

Run the package suite to confirm no regression: `cd packages/llm-unified && bun test`
Expected: PASS (existing baseline unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/llm-unified/src/transport.ts packages/llm-unified/src/stream-completion.ts packages/llm-unified/src/transport-diagnostics.test.ts
git commit -m "Add diagnostic sink + header redaction to streaming transport

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 2: Report types, collector, environment snapshot, serialiser

**Files:**
- Create: `apps/user-client/src/lib/model-debug.ts`
- Test: `apps/user-client/tests/lib/model-debug.test.ts`

This task builds the pure core. `runStreamingTest` is Task 3.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/lib/model-debug.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  createDiagnosticsCollector,
  formatReport,
  type DiagnosticReport,
} from '../../src/lib/model-debug.js';

function fakeClock(): () => number {
  let t = 0;
  return () => {
    const cur = t;
    t += 100; // each call advances 100ms
    return cur;
  };
}

const ENV: DiagnosticReport['env'] = {
  userAgent: 'TestAgent/1.0',
  platform: 'TestOS · crossOriginIsolated: false',
  crossOriginIsolated: false,
  online: true,
  timeZone: 'America/New_York',
};

describe('createDiagnosticsCollector', () => {
  it('records request, response, first token, gaps, finish into the report', () => {
    const c = createDiagnosticsCollector(fakeClock());
    c.sink.onRequest({ method: 'POST', url: 'https://proxy/chat/completions', headers: {} });
    c.sink.onResponse({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' },
    });
    c.markChunk({ type: 'token', text: '1' });
    c.markChunk({ type: 'token', text: '\n2' });
    c.markChunk({ type: 'finish', reason: 'stop' });
    const report = c.build({
      kind: 'test',
      provider: { displayName: 'nano-gpt', routing: 'cors-proxy', targetHost: 'api.nano-gpt.com', proxyHost: 'proxy' },
      model: 'anthropic/claude-sonnet-4.6',
      whenIso: '2026-06-28T14:03:00.000Z',
      env: ENV,
      outcome: 'success',
      outcomeDetail: 'completed in 0.5s',
    });
    expect(report.chunkCount).toBe(2);
    expect(report.replyText).toBe('1\n2');
    expect(report.response?.headers['content-encoding']).toBe('gzip');
    expect(report.timeline.some((t) => t.text.includes('first token'))).toBe(true);
    expect(report.timeline.some((t) => t.text.includes('finish (stop)'))).toBe(true);
  });

  it('records a stall and an error', () => {
    const c = createDiagnosticsCollector(fakeClock());
    c.sink.onRequest({ method: 'POST', url: 'https://proxy/x', headers: {} });
    c.markChunk({ type: 'token', text: '1' });
    c.markStall(5000);
    c.markError('TypeError: Load failed');
    const report = c.build({
      kind: 'test',
      provider: { displayName: 'p', routing: 'direct', targetHost: 'h' },
      model: 'm',
      whenIso: '2026-06-28T14:03:00.000Z',
      env: ENV,
      outcome: 'failed',
      outcomeDetail: 'stream stalled then errored',
    });
    expect(report.timeline.some((t) => t.text.includes('STALL'))).toBe(true);
    expect(report.error).toContain('TypeError: Load failed');
  });
});

describe('formatReport', () => {
  it('produces a sectioned plain-text report and never leaks a key', () => {
    const c = createDiagnosticsCollector(fakeClock());
    // Simulate a request whose redacted headers (correctly) omit the key,
    // but plant the key in replyText-adjacent fields to prove formatReport
    // only serialises known fields.
    c.sink.onRequest({ method: 'POST', url: 'https://proxy/x', headers: { 'content-type': 'application/json' } });
    c.sink.onResponse({ status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });
    c.markChunk({ type: 'token', text: 'OK' });
    c.markChunk({ type: 'finish', reason: 'stop' });
    const report = c.build({
      kind: 'test',
      provider: { displayName: 'nano-gpt', routing: 'cors-proxy', targetHost: 'api.nano-gpt.com', proxyHost: 'proxy' },
      model: 'anthropic/claude-sonnet-4.6',
      whenIso: '2026-06-28T14:03:00.000Z',
      env: ENV,
      outcome: 'success',
      outcomeDetail: 'completed',
    });
    const text = formatReport(report);
    expect(text).toContain('=== Chatsundere Model Test ===');
    expect(text).toContain('[Environment]');
    expect(text).toContain('[Transport]');
    expect(text).toContain('[Response]');
    expect(text).toContain('[Timeline]');
    expect(text).toContain('[Outcome]');
    expect(text).toContain('anthropic/claude-sonnet-4.6');
    expect(text).not.toContain('sk-'); // no key shape anywhere
  });

  it('labels the partial reply on the chat-failure path', () => {
    const c = createDiagnosticsCollector(fakeClock());
    c.markChunk({ type: 'token', text: 'partial private text' });
    const report = c.build({
      kind: 'chat-failure',
      provider: { displayName: 'p', routing: 'direct', targetHost: 'h' },
      model: 'm',
      whenIso: '2026-06-28T14:03:00.000Z',
      env: ENV,
      outcome: 'failed',
      outcomeDetail: 'errored',
    });
    const text = formatReport(report);
    expect(text).toContain('Partial reply your device received');
    expect(text).toContain('partial private text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/lib/model-debug.test.ts`
Expected: FAIL — module `../../src/lib/model-debug.js` not found.

- [ ] **Step 3: Implement model-debug.ts (core only)**

Create `apps/user-client/src/lib/model-debug.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import type { StreamChunk } from '@chatsundere/llm-unified';
import type { StreamDiagnosticsSink } from '@chatsundere/llm-unified';

/** Best-effort snapshot of the user's runtime, captured at report-build time. */
export interface EnvSnapshot {
  userAgent: string;
  platform: string;
  crossOriginIsolated: boolean;
  online: boolean;
  timeZone: string;
}

export interface DiagnosticReport {
  kind: 'test' | 'chat-failure';
  provider: {
    displayName: string;
    routing: 'direct' | 'cors-proxy';
    targetHost: string;
    proxyHost?: string;
  };
  model: string;
  whenIso: string;
  env: EnvSnapshot;
  request?: { method: string; url: string };
  response?: { status: number; statusText: string; headers: Record<string, string> };
  timeline: { atMs: number; text: string }[];
  chunkCount: number;
  replyText: string;
  outcome: 'success' | 'failed';
  outcomeDetail: string;
  error?: string;
  totalMs: number;
}

type BuildMeta = Omit<
  DiagnosticReport,
  'request' | 'response' | 'timeline' | 'chunkCount' | 'replyText' | 'error' | 'totalMs'
>;

/** Reads navigator/Intl for the [Environment] block. Safe in SSR/jsdom. */
export function buildEnvironmentSnapshot(): EnvSnapshot {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let timeZone = 'unknown';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  } catch {
    // Intl may be unavailable in exotic runtimes; leave 'unknown'.
  }
  const coi = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  const ua = nav?.userAgent ?? 'unknown';
  return {
    userAgent: ua,
    platform: `${nav?.platform ?? 'unknown'} · crossOriginIsolated: ${coi}`,
    crossOriginIsolated: coi,
    online: nav?.onLine ?? true,
    timeZone,
  };
}

/**
 * Accumulates a transport timeline from sink events + stream chunks. `now`
 * defaults to a monotonic clock; tests inject a deterministic one. On a
 * tool-loop the caller fires `onRequest` again per round — the timeline keeps
 * all lines, and `build()` reports the whole accumulation (the last request
 * segment is the one that was active when a failure landed).
 */
export function createDiagnosticsCollector(now: () => number = () => performance.now()) {
  const start = now();
  const timeline: { atMs: number; text: string }[] = [];
  let request: DiagnosticReport['request'];
  let response: DiagnosticReport['response'];
  let chunkCount = 0;
  let replyText = '';
  let firstTokenSeen = false;
  let lastChunkAt = start;

  const rel = (): number => Math.round(now() - start);

  const sink: StreamDiagnosticsSink = {
    onRequest(info) {
      request = { method: info.method, url: info.url };
      firstTokenSeen = false;
      lastChunkAt = now();
      timeline.push({ atMs: rel(), text: `request sent → ${info.method} ${info.url}` });
    },
    onResponse(info) {
      response = info;
      const ct = info.headers['content-type'];
      const ce = info.headers['content-encoding'];
      timeline.push({
        atMs: rel(),
        text:
          `response headers · HTTP ${info.status} ${info.statusText}` +
          (ct ? ` · content-type: ${ct}` : '') +
          (ce ? ` · content-encoding: ${ce} ⚠` : ''),
      });
    },
  };

  return {
    sink,
    markChunk(chunk: StreamChunk): void {
      const t = now();
      if (chunk.type === 'token') {
        chunkCount += 1;
        replyText += chunk.text;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          timeline.push({ atMs: rel(), text: `first token (${JSON.stringify(chunk.text)})` });
        } else {
          timeline.push({ atMs: rel(), text: `chunk ${chunkCount} (gap ${Math.round(t - lastChunkAt)}ms)` });
        }
        lastChunkAt = t;
      } else if (chunk.type === 'reasoning') {
        lastChunkAt = t;
      } else if (chunk.type === 'finish') {
        timeline.push({ atMs: rel(), text: `finish (${chunk.reason})` });
      } else if (chunk.type === 'error') {
        timeline.push({ atMs: rel(), text: `✗ stream error chunk: ${chunk.message}` });
      }
    },
    markStall(sinceMs: number): void {
      timeline.push({ atMs: rel(), text: `⚠ STALL — no chunk for ${sinceMs}ms` });
    },
    markError(message: string): void {
      timeline.push({ atMs: rel(), text: `✗ ERROR ${message} (chunks so far: ${chunkCount})` });
    },
    build(meta: BuildMeta): DiagnosticReport {
      return {
        ...meta,
        request,
        response,
        timeline,
        chunkCount,
        replyText,
        error: meta.outcome === 'failed' ? (timeline.find((t) => t.text.startsWith('✗ ERROR'))?.text ?? meta.outcomeDetail) : undefined,
        totalMs: rel(),
      };
    },
  };
}

const REPLY_LABEL_TEST = 'Reply received';
const REPLY_LABEL_CHAT = 'Partial reply your device received — included so we can spot corruption';

/** Serialise a report to the plain text used by the rendered block and copy. */
export function formatReport(r: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push('=== Chatsundere Model Test ===');
  lines.push(
    `Provider:  ${r.provider.displayName} (${r.provider.routing}${r.provider.proxyHost ? ` → ${r.provider.proxyHost}` : ''})`,
  );
  lines.push(`Model:     ${r.model}`);
  lines.push(`When:      ${r.whenIso}`);
  lines.push('');
  lines.push('[Environment]');
  lines.push(`UA: ${r.env.userAgent}`);
  lines.push(`${r.env.platform} · online: ${r.env.online} · TZ: ${r.env.timeZone}`);
  lines.push('');
  lines.push('[Transport]');
  lines.push(`Route: ${r.provider.routing}   Target host: ${r.provider.targetHost}`);
  lines.push('');
  if (r.response) {
    lines.push('[Response]');
    const ce = r.response.headers['content-encoding'];
    const ct = r.response.headers['content-type'];
    lines.push(
      `HTTP ${r.response.status} ${r.response.statusText}` +
        (ct ? ` · content-type: ${ct}` : '') +
        (ce ? ` · content-encoding: ${ce} ⚠` : ''),
    );
    lines.push('');
  }
  lines.push('[Timeline]');
  for (const t of r.timeline) lines.push(`+${t.atMs}ms`.padEnd(10) + t.text);
  lines.push('');
  if (r.replyText.length > 0) {
    lines.push(`[${r.kind === 'chat-failure' ? REPLY_LABEL_CHAT : REPLY_LABEL_TEST}]`);
    lines.push(r.replyText);
    lines.push('');
  }
  lines.push(`[Outcome] ${r.outcome === 'success' ? 'OK' : 'FAILED'} — ${r.outcomeDetail}`);
  return lines.join('\n');
}
```

> Note: confirm the package import name. If `@chatsundere/llm-unified` does not
> re-export `StreamChunk` / `StreamDiagnosticsSink`, import from the specific
> entry the repo uses (check `packages/llm-unified/package.json` `exports` and an
> existing user-client import of llm-unified types, e.g. in `stream-engine.ts`).
> Match that exact specifier.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/lib/model-debug.test.ts`
Expected: PASS (all collector + formatReport cases green).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/model-debug.ts apps/user-client/tests/lib/model-debug.test.ts
git commit -m "Add model-debug report core: collector, env snapshot, serialiser

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 3: runStreamingTest orchestrator

**Files:**
- Modify: `apps/user-client/src/lib/model-debug.ts`
- Test: `apps/user-client/tests/lib/model-debug.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append to the existing file)**

Append to `apps/user-client/tests/lib/model-debug.test.ts`:

```typescript
import { runStreamingTest, type RunStreamingTestArgs } from '../../src/lib/model-debug.js';
import type { StreamChunk, StreamCompletionArgs } from '@chatsundere/llm-unified';

const OFFERING = {
  upstreamSlug: 'anthropic/claude-sonnet-4.6',
  adapter: { kind: 'generic' },
  serviceKind: 'llm',
} as unknown as RunStreamingTestArgs['offering'];

const BASE: Omit<RunStreamingTestArgs, '_streamFn' | 'signal'> = {
  provider: { displayName: 'nano-gpt', baseUrl: 'https://api.nano-gpt.com' } as RunStreamingTestArgs['provider'],
  providerConfig: { baseUrl: 'https://api.nano-gpt.com', routing: { kind: 'cors-proxy' } },
  apiKey: 'sk-supersecret',
  corsProxyUrl: 'https://proxy',
  corsProxyKey: 'proxy-secret',
  offering: OFFERING,
  proxyHost: 'proxy',
};

async function* okStream(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  args.onDiagnostics?.onRequest({ method: 'POST', url: 'https://proxy/chat/completions', headers: {} });
  args.onDiagnostics?.onResponse({ status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });
  yield { type: 'token', text: '1' };
  yield { type: 'token', text: '\n2' };
  yield { type: 'finish', reason: 'stop' };
}

async function* errStream(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  args.onDiagnostics?.onRequest({ method: 'POST', url: 'https://proxy/x', headers: {} });
  throw new TypeError('Load failed');
  yield { type: 'token', text: 'never' }; // eslint-disable-line no-unreachable
}

describe('runStreamingTest', () => {
  it('reports success and accumulates the reply', async () => {
    const ctrl = new AbortController();
    const report = await runStreamingTest({ ...BASE, signal: ctrl.signal, _streamFn: okStream });
    expect(report.outcome).toBe('success');
    expect(report.replyText).toBe('1\n2');
    expect(report.model).toBe('anthropic/claude-sonnet-4.6');
    expect(formatReport(report)).not.toContain('sk-supersecret');
  });

  it('reports failure with the error type when the stream throws', async () => {
    const ctrl = new AbortController();
    const report = await runStreamingTest({ ...BASE, signal: ctrl.signal, _streamFn: errStream });
    expect(report.outcome).toBe('failed');
    expect(report.error).toContain('TypeError: Load failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/lib/model-debug.test.ts`
Expected: FAIL — `runStreamingTest` / `RunStreamingTestArgs` not exported.

- [ ] **Step 3: Add runStreamingTest to model-debug.ts**

Append to `apps/user-client/src/lib/model-debug.ts`:

```typescript
import { offeringToTarget, streamCompletion } from '@chatsundere/llm-unified';
import type {
  Offering,
  ProviderConfig,
  ProviderDefinition,
} from '@chatsundere/llm-unified';

const TEST_PROMPT = 'Count slowly from 1 to 10. Put each number on its own line.';
const STALL_MS = 5000;

export interface RunStreamingTestArgs {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  /** Host shown in the report for cors-proxy routing (no scheme). */
  proxyHost?: string;
  signal: AbortSignal;
  /** Test seam: inject a fake stream. Defaults to the real streamCompletion. */
  _streamFn?: typeof streamCompletion;
  /** Test seam: deterministic clock. */
  _now?: () => number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Runs the real streaming transport against a fixed multi-token prompt and
 * returns a DiagnosticReport. A 5 s stall watchdog appends a STALL line without
 * killing the connection; the overall timeout + Stop is the caller's
 * AbortController (passed via `signal`).
 */
export async function runStreamingTest(args: RunStreamingTestArgs): Promise<DiagnosticReport> {
  const streamFn = args._streamFn ?? streamCompletion;
  const collector = createDiagnosticsCollector(args._now);
  const env = buildEnvironmentSnapshot();
  const routing = args.providerConfig.routing.kind === 'cors-proxy' ? 'cors-proxy' : 'direct';
  let outcome: 'success' | 'failed' = 'failed';
  let outcomeDetail = 'unknown';
  let stalled = false;

  try {
    const iterable = streamFn({
      provider: args.provider,
      providerConfig: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      target: offeringToTarget(args.offering),
      messages: [{ role: 'user', content: TEST_PROMPT }],
      bodyExtras: {},
      signal: args.signal,
      onDiagnostics: collector.sink,
    });
    const iterator = iterable[Symbol.asyncIterator]();
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stallP = new Promise<'stall'>((resolve) => {
        timer = setTimeout(() => resolve('stall'), STALL_MS);
      });
      const nextP = iterator.next();
      const winner = await Promise.race([nextP, stallP]);
      if (winner === 'stall') {
        stalled = true;
        collector.markStall(STALL_MS);
        const r = await nextP; // keep awaiting the real chunk
        if (timer) clearTimeout(timer);
        if (r.done) break;
        collector.markChunk(r.value);
        continue;
      }
      if (timer) clearTimeout(timer);
      const r = winner as IteratorResult<StreamChunk>;
      if (r.done) break;
      collector.markChunk(r.value);
    }
    outcome = 'success';
    outcomeDetail = 'stream completed';
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    collector.markError(msg);
    outcome = 'failed';
    outcomeDetail = stalled ? 'stream stalled then errored' : 'errored before completing';
  }

  return collector.build({
    kind: 'test',
    provider: {
      displayName: args.provider.displayName,
      routing,
      targetHost: hostOf(args.provider.baseUrl),
      ...(routing === 'cors-proxy' && args.proxyHost ? { proxyHost: args.proxyHost } : {}),
    },
    model: args.offering.upstreamSlug,
    whenIso: new Date().toISOString(),
    env,
    outcome,
    outcomeDetail,
  });
}
```

> Adjust the import specifiers to match the repo (Task 2 note). Verify
> `offeringToTarget` and `streamCompletion` are exported from the package root;
> if not, import from the same paths `stream-engine.ts` uses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/lib/model-debug.test.ts`
Expected: PASS (success + failure cases green; no key leak).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/model-debug.ts apps/user-client/tests/lib/model-debug.test.ts
git commit -m "Add runStreamingTest: real streaming path with stall watchdog

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 4: ModelDebugReport component

**Files:**
- Create: `apps/user-client/src/components/ModelDebugReport.tsx`
- Test: `apps/user-client/tests/components/ModelDebugReport.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/ModelDebugReport.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelDebugReport } from '../../src/components/ModelDebugReport.js';
import type { DiagnosticReport } from '../../src/lib/model-debug.js';

const REPORT: DiagnosticReport = {
  kind: 'test',
  provider: { displayName: 'nano-gpt', routing: 'cors-proxy', targetHost: 'api.nano-gpt.com', proxyHost: 'proxy' },
  model: 'anthropic/claude-sonnet-4.6',
  whenIso: '2026-06-28T14:03:00.000Z',
  env: {
    userAgent: 'TestAgent/1.0',
    platform: 'iPhone · crossOriginIsolated: false',
    crossOriginIsolated: false,
    online: true,
    timeZone: 'America/New_York',
  },
  response: { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' } },
  timeline: [{ atMs: 0, text: 'request sent → POST https://proxy/x' }],
  chunkCount: 1,
  replyText: '1\n2',
  outcome: 'failed',
  outcomeDetail: 'stream stalled then errored',
  error: '✗ ERROR TypeError: Load failed',
  totalMs: 16300,
};

describe('ModelDebugReport', () => {
  it('renders the warm top line, the what-next line, and the report body', () => {
    render(<ModelDebugReport report={REPORT} />);
    expect(screen.getByText(/Thanks for this/i)).toBeInTheDocument();
    expect(screen.getByText(/Paste this into your reply to us/i)).toBeInTheDocument();
    expect(screen.getByText(/anthropic\/claude-sonnet-4\.6/)).toBeInTheDocument();
  });

  it('copies the formatted report to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ModelDebugReport report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('=== Chatsundere Model Test ===');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/ModelDebugReport.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement ModelDebugReport.tsx**

Create `apps/user-client/src/components/ModelDebugReport.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { formatReport, type DiagnosticReport } from '../lib/model-debug.js';

interface Props {
  report: DiagnosticReport;
  /** Shown above the link in the chat-failure footer context; harmless here. */
  perishable?: boolean;
}

/**
 * Screenshot-friendly, copyable diagnostic report. Opens with a warm line so a
 * failure reads as the user helping, and closes the loop with a "what next"
 * line under the copy button.
 */
export function ModelDebugReport({ report }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const text = formatReport(report);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the rendered block is the fallback (select + copy).
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-paper-soft">
        Thanks for this — copy it and paste it into your reply to us; it tells us exactly what your
        device saw.
      </p>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-paper-soft/20 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-paper">
        {text}
      </pre>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => void copy()}
          className="self-start rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft"
        >
          {copied ? 'Copied ✓' : 'Copy report'}
        </button>
        <p className="text-xs text-paper-soft/80">Paste this into your reply to us.</p>
      </div>
    </div>
  );
}
```

> Match the surrounding Tailwind token vocabulary (`text-paper`, `text-ink`,
> `bg-paper`, `border-paper-soft`) used in `provider.tsx`. If a token differs in
> this repo, mirror the nearest existing usage rather than inventing one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/ModelDebugReport.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/ModelDebugReport.tsx apps/user-client/tests/components/ModelDebugReport.test.tsx
git commit -m "Add ModelDebugReport: warm copyable diagnostic block

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 5: ModelDebugOverlay component

**Files:**
- Create: `apps/user-client/src/components/ModelDebugOverlay.tsx`
- Test: `apps/user-client/tests/components/ModelDebugOverlay.test.tsx`

The overlay is presentation + run orchestration. Decryption/proxy resolution is
injected via an async `resolve` prop (the page holds the master key), keeping
this component crypto-free.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/components/ModelDebugOverlay.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelDebugOverlay } from '../../src/components/ModelDebugOverlay.js';
import type { DiagnosticReport } from '../../src/lib/model-debug.js';

const OFFERINGS = [
  { upstreamSlug: 'anthropic/claude-sonnet-4.6', serviceKind: 'llm' },
  { upstreamSlug: 'meta/llama-3', serviceKind: 'llm' },
  { upstreamSlug: 'some/tts-voice', serviceKind: 'tts' },
] as unknown as React.ComponentProps<typeof ModelDebugOverlay>['offerings'];

const REPORT: DiagnosticReport = {
  kind: 'test',
  provider: { displayName: 'p', routing: 'direct', targetHost: 'h' },
  model: 'anthropic/claude-sonnet-4.6',
  whenIso: '2026-06-28T14:03:00.000Z',
  env: { userAgent: 'x', platform: 'x', crossOriginIsolated: false, online: true, timeZone: 'x' },
  timeline: [],
  chunkCount: 0,
  replyText: '',
  outcome: 'success',
  outcomeDetail: 'ok',
  totalMs: 1,
};

describe('ModelDebugOverlay', () => {
  it('lists only llm offerings and runs the chosen model', async () => {
    const run = vi.fn().mockResolvedValue(REPORT);
    render(
      <ModelDebugOverlay
        open
        providerDisplayName="p"
        offerings={OFFERINGS}
        onClose={() => {}}
        runTest={run}
      />,
    );
    // tts offering is filtered out
    expect(screen.queryByText('some/tts-voice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('anthropic/claude-sonnet-4.6'));
    fireEvent.click(screen.getByRole('button', { name: /run streaming test/i }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0].upstreamSlug).toBe('anthropic/claude-sonnet-4.6');
    await screen.findByText(/Copy report/i);
  });

  it('disables run until a model is chosen', () => {
    render(
      <ModelDebugOverlay open providerDisplayName="p" offerings={OFFERINGS} onClose={() => {}} runTest={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /run streaming test/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/ModelDebugOverlay.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement ModelDebugOverlay.tsx**

Create `apps/user-client/src/components/ModelDebugOverlay.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { Offering } from '@chatsundere/llm-unified';
import { PickerOverlay } from './ui/PickerOverlay.js';
import { ModelDebugReport } from './ModelDebugReport.js';
import type { DiagnosticReport } from '../lib/model-debug.js';

interface Props {
  open: boolean;
  providerDisplayName: string;
  offerings: Offering[];
  onClose: () => void;
  /**
   * Runs the test for one offering and returns the report. The page supplies
   * this (it resolves the decrypted key + proxy + a 60 s-timeout AbortController);
   * the overlay stays crypto-free and easily testable.
   */
  runTest: (offering: Offering) => Promise<DiagnosticReport>;
}

const TIMEOUT_MS = 60_000;

/** Provider-scoped model debugger: pick an LLM offering, run the real stream, see + copy the report. */
export function ModelDebugOverlay({ open, providerDisplayName, offerings, onClose, runTest }: Props): JSX.Element {
  const llmOfferings = offerings.filter((o) => o.serviceKind === 'llm');
  const [selected, setSelected] = useState<Offering | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);

  async function run(): Promise<void> {
    if (!selected) return;
    setRunning(true);
    setReport(null);
    try {
      setReport(await runTest(selected));
    } finally {
      setRunning(false);
    }
  }

  return (
    <PickerOverlay open={open} title={`Test a model · ${providerDisplayName}`} onClose={onClose}>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-xs text-paper-soft">
          Pick a model and run a real streaming test. If it fails, copy the report and send it to us.
        </p>
        <ul className="flex flex-col gap-1" role="listbox" aria-label="Models">
          {llmOfferings.map((o) => (
            <li key={o.upstreamSlug}>
              <button
                type="button"
                role="option"
                aria-selected={selected?.upstreamSlug === o.upstreamSlug}
                onClick={() => setSelected(o)}
                className={`w-full rounded-md border px-3 py-2 text-left font-mono text-xs ${
                  selected?.upstreamSlug === o.upstreamSlug
                    ? 'border-paper bg-paper/10 text-paper'
                    : 'border-paper-soft/20 text-paper-soft hover:bg-paper-soft/5'
                }`}
              >
                {o.upstreamSlug}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!selected || running}
          className="self-start rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run streaming test'}
        </button>
        {report ? <ModelDebugReport report={report} /> : null}
      </div>
    </PickerOverlay>
  );
}

export const MODEL_DEBUG_TIMEOUT_MS = TIMEOUT_MS;
```

> The 60 s timeout + Stop wiring lives where `runTest` is built (Task 6): the
> page arms an AbortController with `setTimeout(abort, MODEL_DEBUG_TIMEOUT_MS)`.
> Keeping the abort outside the overlay keeps this component pure for testing.
> If a visible Stop button is wanted inside the overlay, pass an `onStop` prop
> from the page and render it while `running` — left out here to keep Task 5
> minimal; add it in Task 6 if device testing shows it is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/ModelDebugOverlay.test.tsx`
Expected: PASS (filtering + run + disabled-until-picked).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/components/ModelDebugOverlay.tsx apps/user-client/tests/components/ModelDebugOverlay.test.tsx
git commit -m "Add ModelDebugOverlay: provider-scoped model test surface

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 6: Wire the gated "Test a model" button into provider.tsx

**Files:**
- Modify: `apps/user-client/src/routes/app/settings/provider.tsx`

No new unit test (wiring + gating is covered by manual verification §14.0 and the
overlay's own tests). Keep the gating logic obvious.

- [ ] **Step 1: Add overlay state + the resolve/run closure**

In `SettingsProviderPage`, after the existing `useState` hooks, add:

```typescript
  const [debugOpen, setDebugOpen] = useState(false);
```

Compute the gate (place near `requiresProxy`):

```typescript
  // "Test a model" can only reach the transport when a key is saved and, for
  // proxy-required providers, a CORS proxy is configured. Otherwise a precondition
  // failure would masquerade as a model failure (Laura HARD, spec §7).
  const hasSavedKey = existing != null;
  const proxyReady = !requiresProxy || settings.data?.corsProxy != null;
  const testDisabledReason = !hasSavedKey
    ? 'Save a key first'
    : !proxyReady
      ? 'Set a CORS proxy first'
      : null;
```

Define the per-offering run closure (resolves the decrypted key + proxy, arms the
60 s timeout, calls `runStreamingTest`):

```typescript
  async function runDebugTest(offering: Offering): Promise<DiagnosticReport> {
    if (!definition || !existing || !mk) {
      throw new Error('model debug: provider not fully configured');
    }
    const sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
    const corsProxyKey =
      requiresProxy && sealedShared
        ? await openSecret(sealedShared, mk, 'cors-proxy/shared-key')
        : null;
    const corsProxyUrl = requiresProxy ? (settings.data?.corsProxy?.url ?? null) : null;
    const apiKeyPlain = await openSecret(existing.apiKey, mk, existing.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_DEBUG_TIMEOUT_MS);
    try {
      return await runStreamingTest({
        provider: definition,
        providerConfig: {
          baseUrl: definition.baseUrl,
          routing: requiresProxy ? { kind: 'cors-proxy' } : { kind: 'direct' },
        },
        apiKey: apiKeyPlain,
        corsProxyUrl,
        corsProxyKey,
        offering,
        proxyHost: corsProxyUrl ? new URL(corsProxyUrl).host : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
```

> Confirm the api-key slot id. `provider.tsx` decrypts via
> `openSecret(stableSealedKey, mk, stableSlotId)` — use the **same** `stableSealedKey`
> and `stableSlotId` values the existing onSave path uses for this provider (they
> are derived from `existing`). Read the real lines around provider.tsx:96–115 and
> mirror them exactly rather than guessing `existing.apiKey` / `existing.id`.

- [ ] **Step 2: Add the imports**

At the top of `provider.tsx`, add:

```typescript
import type { Offering } from '@chatsundere/llm-unified';
import { runStreamingTest, type DiagnosticReport } from '../../../lib/model-debug.js';
import { ModelDebugOverlay, MODEL_DEBUG_TIMEOUT_MS } from '../../../components/ModelDebugOverlay.js';
```

> Fix the relative depth to match `provider.tsx`'s actual location
> (`routes/app/settings/provider.tsx` → `../../../` reaches `src/`). Verify against
> the existing imports in the file.

- [ ] **Step 3: Render the button + overlay**

In the action area, after the `Test & Save` button block (around provider.tsx:237)
and before the `Remove provider` block, add:

```tsx
        <button
          type="button"
          onClick={() => setDebugOpen(true)}
          disabled={testDisabledReason != null}
          title={testDisabledReason ?? undefined}
          className="self-start rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:bg-paper-soft/10 disabled:opacity-50"
        >
          Test a model
        </button>
        {testDisabledReason != null ? (
          <p className="text-xs text-paper-soft/70">{testDisabledReason}</p>
        ) : null}
```

At the end of the component's returned JSX (alongside `helpOverlay`), add:

```tsx
        {definition ? (
          <ModelDebugOverlay
            open={debugOpen}
            providerDisplayName={definition.displayName}
            offerings={definition.offerings}
            onClose={() => setDebugOpen(false)}
            runTest={runDebugTest}
          />
        ) : null}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/user-client && pnpm typecheck`
Expected: PASS (0 errors). Fix any import-path / type mismatches surfaced here.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/settings/provider.tsx
git commit -m "Wire gated Test-a-model button + overlay into provider page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 7: Capture + store the chat-failure report

**Files:**
- Modify: `apps/user-client/src/lib/stream-engine.ts`
- Modify: `apps/user-client/src/state/stream-manager.store.ts`

- [ ] **Step 1: Thread onDiagnostics through stream-engine**

In `apps/user-client/src/lib/stream-engine.ts`:

Add to `StartStreamArgs` (after `onChunk`):

```typescript
  /** Optional diagnostic capture sink, forwarded to the streaming transport. */
  onDiagnostics?: StreamDiagnosticsSink;
```

Import the type (alongside the existing llm-unified import):

```typescript
import type { StreamDiagnosticsSink } from '@chatsundere/llm-unified';
```

In the `streamCompletion({ ... })` call (stream-engine.ts ~133), add one line:

```typescript
    onDiagnostics: args.onDiagnostics,
```

- [ ] **Step 2: Add the diagnostics map to the store**

In `apps/user-client/src/state/stream-manager.store.ts`:

Import the report core:

```typescript
import {
  buildEnvironmentSnapshot,
  createDiagnosticsCollector,
  type DiagnosticReport,
} from '../lib/model-debug.js';
```

Add to the `StreamManagerStore` interface (find the interface that declares
`streams: Map<...>` and `compactingState`) a new field:

```typescript
  /** Last failure report per chat (in-memory; perishable — lost on reload). */
  diagnostics: Map<string, DiagnosticReport>;
  clearDiagnostics(chatId: string): void;
```

In the `create<StreamManagerStore>((set, get) => ({ ... }))` initialiser, beside
`streams: new Map(),`:

```typescript
  diagnostics: new Map(),
  clearDiagnostics: (chatId) =>
    set((s) => {
      if (!s.diagnostics.has(chatId)) return s;
      const m = new Map(s.diagnostics);
      m.delete(chatId);
      return { diagnostics: m };
    }),
```

- [ ] **Step 3: Arm a collector in runIntoDraft and store the report on failure**

In `runIntoDraft` (stream-manager.store.ts), right after the `const controller = new AbortController();`
line, create a collector and clear any stale report for this chat:

```typescript
  const diag = createDiagnosticsCollector();
  set((s) => {
    if (!s.diagnostics.has(args.chatId)) return s;
    const m = new Map(s.diagnostics);
    m.delete(args.chatId);
    return { diagnostics: m };
  });
```

Forward the sink into the `runStreamEngine({ ... })` call inside `streamOnce`
(add one line to the object passed to `runStreamEngine`):

```typescript
        onDiagnostics: diag.sink,
```

Feed reply tokens into the collector from the existing `onChunk` handler. Inside
`onChunk`, before the early `if (chunk.type !== 'token' && chunk.type !== 'reasoning') return;`,
add:

```typescript
    diag.markChunk(chunk);
```

> This double-counts nothing — `diag.markChunk` only appends to the timeline and
> reply buffer; the existing handle-mirroring logic is untouched below it.

In the `.catch(async (err) => { ... })` block, after the existing
`console.error(...)` line, build and store the report:

```typescript
      const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      diag.markError(errMsg);
      const routing = args.providerConfig.routing.kind === 'cors-proxy' ? 'cors-proxy' : 'direct';
      const report = diag.build({
        kind: 'chat-failure',
        provider: {
          displayName: args.provider.displayName,
          routing,
          targetHost: (() => {
            try {
              return new URL(args.provider.baseUrl).host;
            } catch {
              return args.provider.baseUrl;
            }
          })(),
          ...(routing === 'cors-proxy' && args.corsProxyUrl
            ? { proxyHost: new URL(args.corsProxyUrl).host }
            : {}),
        },
        model: args.offering.upstreamSlug,
        whenIso: new Date().toISOString(),
        env: buildEnvironmentSnapshot(),
        outcome: 'failed',
        outcomeDetail: 'stream failed during chat',
      });
      set((s) => {
        const m = new Map(s.diagnostics);
        m.set(args.chatId, report);
        return { diagnostics: m };
      });
```

> `args.provider`, `args.providerConfig`, `args.corsProxyUrl`, and `args.offering`
> are all present on `StartArgs` (it extends `StartStreamArgs`). Confirm by reading
> the `StartArgs` definition (~line 79) — they are inherited from `StartStreamArgs`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/user-client && pnpm typecheck`
Expected: PASS. Fix any type gaps (e.g. the `StreamManagerStore` interface name —
confirm it from the file).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/lib/stream-engine.ts apps/user-client/src/state/stream-manager.store.ts
git commit -m "Capture in-memory diagnostic report on chat stream failure

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 8: Footer link + chat-page overlay wiring

**Files:**
- Modify: `apps/user-client/src/components/chat/StreamInterruptedFooter.tsx`
- Modify: `apps/user-client/src/routes/app/chat/chat-page.tsx`
- Test: `apps/user-client/tests/components/StreamInterruptedFooter.test.tsx`

- [ ] **Step 1: Write the failing test for the footer**

Create `apps/user-client/tests/components/StreamInterruptedFooter.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StreamInterruptedFooter } from '../../src/components/chat/StreamInterruptedFooter.js';

describe('StreamInterruptedFooter', () => {
  it('shows no diagnostics affordance when onShowDiagnostics is absent', () => {
    render(<StreamInterruptedFooter onRetry={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByRole('button', { name: /show diagnostics/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/before reloading/i)).not.toBeInTheDocument();
  });

  it('shows the diagnostics link + perishable nudge when provided, and fires it', () => {
    const onShow = vi.fn();
    render(
      <StreamInterruptedFooter onRetry={() => {}} onDiscard={() => {}} onShowDiagnostics={onShow} />,
    );
    expect(screen.getByText(/before reloading/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show diagnostics/i }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/StreamInterruptedFooter.test.tsx`
Expected: FAIL — `onShowDiagnostics` prop / link do not exist.

- [ ] **Step 3: Extend StreamInterruptedFooter**

Replace `apps/user-client/src/components/chat/StreamInterruptedFooter.tsx` with:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  onRetry: () => void;
  onDiscard: () => void;
  disabled?: boolean;
  /** Present only when an in-memory diagnostic report exists for this message. */
  onShowDiagnostics?: () => void;
}

/** Rendered below an incomplete persona-message to offer Retry / Discard recovery. */
export function StreamInterruptedFooter(p: Props): JSX.Element {
  return (
    <div className="stream-interrupted" role="alert">
      <div className="stream-interrupted-text">
        <span aria-hidden="true">⚠</span>
        <span>Stream interrupted</span>
      </div>
      <div className="stream-interrupted-actions">
        <button type="button" data-action="retry" disabled={p.disabled} onClick={p.onRetry} className="ctrl-btn">
          ↻ Retry
        </button>
        <button type="button" data-action="discard" disabled={p.disabled} onClick={p.onDiscard} className="ctrl-btn">
          ⌫ Discard
        </button>
      </div>
      {p.onShowDiagnostics ? (
        <div className="stream-interrupted-diag">
          <button
            type="button"
            data-action="diagnostics"
            onClick={p.onShowDiagnostics}
            className="stream-interrupted-diag-link"
          >
            Show diagnostics
          </button>
          <span className="stream-interrupted-diag-hint">Copy this before reloading</span>
        </div>
      ) : null}
    </div>
  );
}
```

> The diagnostics row is intentionally quieter than Retry/Discard (a text link,
> not a peer `ctrl-btn`). Add minimal CSS for `.stream-interrupted-diag`,
> `.stream-interrupted-diag-link` (underlined, `text-paper-soft`, smaller), and
> `.stream-interrupted-diag-hint` (smallest, dim) next to the existing
> `.stream-interrupted*` rules in the same stylesheet (`grep -rn
> "stream-interrupted" apps/user-client/src` to find it). Keep it understated so
> it never competes with recovery.

- [ ] **Step 4: Wire chat-page to feed onShowDiagnostics + render the report overlay**

In `apps/user-client/src/routes/app/chat/chat-page.tsx`:

Add imports:

```typescript
import { ReadingOverlay } from '../../../components/ui/ReadingOverlay.js';
import { ModelDebugReport } from '../../../components/ModelDebugReport.js';
```

> If `ReadingOverlay` renders Markdown rather than arbitrary children, instead use
> `PickerOverlay` (children-based) for the report, mirroring the import used in
> `ModelDebugOverlay`. Pick whichever overlay in `components/ui/` accepts a React
> child node; verify before wiring.

Add the selector + local overlay state near the existing `streamHandle` selector
(chat-page.tsx ~310):

```typescript
  const diagnosticsReport = useStreamManagerStore((s) =>
    activeChatId ? (s.diagnostics.get(activeChatId) ?? null) : null,
  );
  const [diagOpen, setDiagOpen] = useState(false);
```

> `useState` is already imported in this file; confirm.

In the `StreamInterruptedFooter` render (chat-page.tsx ~692), add the prop —
present only when a report exists:

```tsx
          <StreamInterruptedFooter
            disabled={isStreamLive}
            onShowDiagnostics={diagnosticsReport ? () => setDiagOpen(true) : undefined}
            onRetry={async () => {
```

Render the report overlay near the bottom of the returned JSX (alongside other
overlays):

```tsx
      {diagnosticsReport ? (
        <PickerOverlay open={diagOpen} title="Diagnostics" onClose={() => setDiagOpen(false)}>
          <div className="p-4">
            <ModelDebugReport report={diagnosticsReport} />
          </div>
        </PickerOverlay>
      ) : null}
```

> Import `PickerOverlay` if not already present in chat-page.tsx. (This uses
> `PickerOverlay` for a children-based overlay; if the file already imports a
> suitable overlay, reuse it.)

- [ ] **Step 5: Run footer test + typecheck**

Run: `cd apps/user-client && pnpm exec vitest run tests/components/StreamInterruptedFooter.test.tsx`
Expected: PASS.

Run: `cd apps/user-client && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/chat/StreamInterruptedFooter.tsx apps/user-client/src/routes/app/chat/chat-page.tsx apps/user-client/tests/components/StreamInterruptedFooter.test.tsx
# also add the stylesheet you edited for .stream-interrupted-diag*
git commit -m "Surface chat-failure diagnostics via quiet footer link

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Task 9: Full gate run + STATUS update

**Files:**
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Run the full gates**

```bash
cd /home/chris/workspace/chatsundere
pnpm typecheck --force
pnpm build
pnpm --filter @chatsundere/user-client test
( cd packages/llm-unified && bun test )
pnpm exec biome check apps/user-client/src/lib/model-debug.ts apps/user-client/src/components/ModelDebugReport.tsx apps/user-client/src/components/ModelDebugOverlay.tsx packages/llm-unified/src/transport.ts
```

Expected: typecheck 14/14; build green; user-client vitest at the current
baseline + the new suites green; llm-unified bun test green; Biome clean on
changed files.

> If any gate fails, fix before proceeding — do not mark complete with a red gate
> (CLAUDE.md §10). The user-client suite has a known 8 Node-localStorage baseline;
> only *new* failures count.

- [ ] **Step 2: Update STATUS-CLIENT-ONLY.md**

Add a new **Current** entry summarising: the model debugger (provider-page "Test a
model" overlay + chat-failure "Show diagnostics" link), the shared diagnostic sink
in llm-unified with at-source redaction, in-memory chat report (no Dexie change),
Laura spec-pass folded (D6 gating, D7 nudge, D8 labelled text), gate results, and
the spec/plan links. Migrate the previous Current entry into its block chapter per
§16. Update the `Last updated:` line to 2026-06-28.

- [ ] **Step 3: Commit (doc-only)**

```bash
git add obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Update STATUS: model debugger landed [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand back for Laura pre-squash + opus whole-branch review**

Do NOT squash yet. Report completion so Liz can run the **opus whole-branch
review** and **Laura pre-squash pass** (spec §13) before the final squash. Not a
Larissa path, but flag the `transport.ts` redaction for code-review attention.

---

## Self-Review

**Spec coverage:**
- §5 architecture (sink + model-debug + 2 surfaces) → Tasks 1–8. ✓
- §6 sink contract (onRequest/onResponse, optional, redaction at source) → Task 1. ✓
- §7 test inference (fixed prompt, stall watchdog, 60 s timeout, provider-scoped picker, reused resolution, D6 gating) → Tasks 3, 5, 6. ✓
- §8 chat-failure (tool-loop last-segment, in-memory hold, perishable nudge, intent hierarchy, hidden-when-no-report) → Tasks 7, 8. ✓
- §9 redaction (denylist request, allowlist response, no-key test) → Task 1 + Task 2/3 no-key assertions. ✓
- §10 report (warm top line, env, labelled reply D8) → Tasks 2, 4. ✓
- §11 error handling (precondition gate, no-model disabled, clipboard fallback) → Tasks 5, 6, 4. ✓
- §12 testing (collector/format/redaction unit; overlay + footer RTL) → Tasks 1–5, 8. ✓
- §13 audit gates (Laura pre-squash, redaction flagged) → Task 9. ✓
- §14 manual verification → covered by Task 9 handoff. ✓

**Placeholder scan:** No TBD/TODO. The `>`-quoted notes are *verification
instructions* (confirm an import specifier / slot id against the real file), not
deferred work — each names exactly what to check and the fallback. They exist
because import depths and the api-key slot id must be read from the live files,
not guessed.

**Type consistency:** `DiagnosticReport`, `StreamDiagnosticsSink`,
`createDiagnosticsCollector`, `formatReport`, `runStreamingTest`,
`RunStreamingTestArgs`, `buildEnvironmentSnapshot`, `MODEL_DEBUG_TIMEOUT_MS`,
`ModelDebugReport`, `ModelDebugOverlay` are named identically across all tasks.
`build(meta)` consumes `BuildMeta = Omit<DiagnosticReport, ...>` and the call
sites in Tasks 2/3/7 pass exactly those fields.

**Known verification points carried into execution** (not gaps — reads against
live files): (a) the llm-unified type import specifier from user-client; (b) the
api-key `openSecret` slot id used in `provider.tsx`; (c) the `StreamManagerStore`
interface name; (d) which `components/ui` overlay accepts arbitrary children for
the chat report; (e) the `.stream-interrupted*` stylesheet path.
