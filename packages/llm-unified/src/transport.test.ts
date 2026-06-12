// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it, test } from 'bun:test';
import { buildRequest } from './transport.js';
import type { ProviderConfig } from './types.js';

const directConfig: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};

const proxyConfig: ProviderConfig = {
  baseUrl: 'https://ollama.com/v1',
  routing: { kind: 'cors-proxy' },
};

describe('buildRequest', () => {
  it('builds a direct GET request with Bearer auth', () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'sk-abc',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
    expect(req.method).toBe('GET');
    expect(req.headers.get('Authorization')).toBe('Bearer sk-abc');
    expect(req.headers.get('x-cors-proxy-api-key')).toBeNull();
  });

  it('builds a direct POST request with JSON body', async () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'sk-abc',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/chat/completions',
      method: 'POST',
      body: { model: 'm', messages: [] },
    });
    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(await req.json()).toEqual({ model: 'm', messages: [] });
  });

  it('builds a via-cors-proxy request with rewritten URL and proxy headers', () => {
    const req = buildRequest({
      provider: proxyConfig,
      apiKey: 'sk-xyz',
      corsProxyUrl: 'https://cors-proxy.tidesson.net',
      corsProxyKey: 'proxy-secret',
      path: '/chat/completions',
      method: 'POST',
      body: {},
    });
    expect(req.url).toBe('https://cors-proxy.tidesson.net/chat/completions');
    expect(req.headers.get('x-cors-proxy-api-key')).toBe('proxy-secret');
    expect(req.headers.get('x-cors-proxy-target')).toBe('https://ollama.com/v1');
    expect(req.headers.get('Authorization')).toBe('Bearer sk-xyz');
    expect(req.headers.get('Content-Type')).toBe('application/json');
  });

  it('throws when cors-proxy routing is selected but proxy URL is missing', () => {
    expect(() =>
      buildRequest({
        provider: proxyConfig,
        apiKey: 'sk-xyz',
        corsProxyUrl: null,
        corsProxyKey: 'k',
        path: '/x',
        method: 'GET',
      }),
    ).toThrow(/cors-proxy URL/);
  });

  it('throws when cors-proxy routing is selected but proxy key is missing', () => {
    expect(() =>
      buildRequest({
        provider: proxyConfig,
        apiKey: 'sk-xyz',
        corsProxyUrl: 'https://cors-proxy.tidesson.net',
        corsProxyKey: null,
        path: '/x',
        method: 'GET',
      }),
    ).toThrow(/cors-proxy key/);
  });

  it('joins baseUrl + path correctly when baseUrl has trailing slash', () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://nano-gpt.com/api/v1/', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
  });

  it('joins baseUrl + path correctly when path has no leading slash', () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: 'models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
  });
});

describe('buildRequest bodies', () => {
  test('JSON body is stringified with the json content-type', async () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://api.example.test/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/chat/completions',
      method: 'POST',
      body: { a: 1 },
    });
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(await req.text()).toBe('{"a":1}');
  });

  test('FormData body passes through with a multipart boundary', async () => {
    const form = new FormData();
    form.append('model', 'voxtral-mini-latest');
    const req = buildRequest({
      provider: { baseUrl: 'https://api.example.test/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
      corsProxyUrl: null,
      corsProxyKey: null,
      path: '/audio/transcriptions',
      method: 'POST',
      body: form,
    });
    expect(req.headers.get('Content-Type')).toStartWith('multipart/form-data');
    expect(req.headers.get('Authorization')).toBe('Bearer k');
    const echoed = await req.formData();
    expect(echoed.get('model')).toBe('voxtral-mini-latest');
  });
});
