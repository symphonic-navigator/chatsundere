import type { StreamChunk, StreamCompletionArgs } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import {
  type DiagnosticReport,
  type RunStreamingTestArgs,
  buildEnvironmentSnapshot,
  createDiagnosticsCollector,
  formatReport,
  runStreamingTest,
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
      provider: {
        displayName: 'nano-gpt',
        routing: 'cors-proxy',
        targetHost: 'api.nano-gpt.com',
        proxyHost: 'proxy',
      },
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
    c.sink.onRequest({
      method: 'POST',
      url: 'https://proxy/x',
      headers: { 'content-type': 'application/json' },
    });
    c.sink.onResponse({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream' },
    });
    c.markChunk({ type: 'token', text: 'OK' });
    c.markChunk({ type: 'finish', reason: 'stop' });
    const report = c.build({
      kind: 'test',
      provider: {
        displayName: 'nano-gpt',
        routing: 'cors-proxy',
        targetHost: 'api.nano-gpt.com',
        proxyHost: 'proxy',
      },
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
    // structural guard: request headers are never stored, so no key can appear
    expect(text).not.toContain('sk-');
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
    expect(text).toContain('=== Chatsundere Chat-Stream Failure ===');
    expect(text).toContain('Partial reply your device received');
    expect(text).toContain('partial private text');
  });
});

describe('buildEnvironmentSnapshot', () => {
  it('returns a well-typed snapshot under jsdom (SSR-safe guards)', () => {
    const env = buildEnvironmentSnapshot();
    expect(typeof env.userAgent).toBe('string');
    expect(typeof env.online).toBe('boolean');
    expect(typeof env.timeZone).toBe('string');
  });
});

const OFFERING = {
  upstreamSlug: 'anthropic/claude-sonnet-4.6',
  adapter: { kind: 'generic' },
  serviceKind: 'llm',
} as unknown as RunStreamingTestArgs['offering'];

const BASE: Omit<RunStreamingTestArgs, '_streamFn' | 'signal'> = {
  provider: {
    displayName: 'nano-gpt',
    baseUrl: 'https://api.nano-gpt.com',
  } as RunStreamingTestArgs['provider'],
  providerConfig: { baseUrl: 'https://api.nano-gpt.com', routing: { kind: 'cors-proxy' } },
  apiKey: 'sk-supersecret',
  offering: OFFERING,
  proxyHost: 'proxy',
};

async function* okStream(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  args.onDiagnostics?.onRequest({
    method: 'POST',
    url: 'https://proxy/chat/completions',
    headers: {},
  });
  args.onDiagnostics?.onResponse({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/event-stream' },
  });
  yield { type: 'token', text: '1' };
  yield { type: 'token', text: '\n2' };
  yield { type: 'finish', reason: 'stop' };
}

async function* errStream(args: StreamCompletionArgs): AsyncIterable<StreamChunk> {
  args.onDiagnostics?.onRequest({ method: 'POST', url: 'https://proxy/x', headers: {} });
  throw new TypeError('Load failed');
  // biome-ignore lint/correctness/noUnreachable: required to satisfy the generator return type
  yield { type: 'token', text: 'never' };
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
