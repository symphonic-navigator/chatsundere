// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import {
  type StreamDiagnosticsSink,
  buildRequest,
  pickResponseHeaders,
  redactRequestHeaders,
} from './transport.js';

describe('redactRequestHeaders', () => {
  test('drops secret-bearing headers entirely, keeps the rest', () => {
    const h = new Headers({
      Authorization: 'Bearer sk-supersecret',
      'x-api-key': 'sk-supersecret',
      'api-key': 'sk-supersecret',
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
    expect('api-key' in out).toBe(false);
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

  test('redacts the cors-proxy key but keeps the target on the proxy path', () => {
    const seen: { method: string; url: string; headers: Record<string, string> }[] = [];
    const sink: StreamDiagnosticsSink = {
      onRequest: (info) => seen.push(info),
      onResponse: () => {},
    };
    buildRequest({
      provider: { baseUrl: 'https://api.example.com', routing: { kind: 'cors-proxy' } },
      apiKey: 'sk-supersecret',
      corsProxyUrl: 'https://proxy',
      corsProxyKey: 'proxy-secret',
      path: '/chat/completions',
      method: 'POST',
      body: { model: 'm', messages: [] },
      onDiagnostics: sink,
    });
    expect(seen.length).toBe(1);
    expect(seen[0]?.headers['x-cors-proxy-target']).toBe('https://api.example.com');
    const serialised = JSON.stringify(seen[0]?.headers);
    expect(serialised).not.toContain('proxy-secret');
    expect('x-cors-proxy-api-key' in (seen[0]?.headers ?? {})).toBe(false);
  });
});
