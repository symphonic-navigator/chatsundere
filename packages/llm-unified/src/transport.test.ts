// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it, test } from 'bun:test';
import { registerBuiltinProviders } from './providers/_register-builtins.js';
import { setProxyAuthSource } from './proxy-auth.js';
import { listProviders } from './registry.js';
import {
  ProxyUnavailableError,
  SECRET_REQUEST_HEADERS,
  buildRequest,
  redactRequestHeaders,
} from './transport.js';
import type { ProviderConfig } from './types.js';

const directConfig: ProviderConfig = {
  baseUrl: 'https://nano-gpt.com/api/v1',
  routing: { kind: 'direct' },
};

const proxyConfig: ProviderConfig = {
  baseUrl: 'https://ollama.com',
  routing: { kind: 'cors-proxy' },
};

afterEach(() => setProxyAuthSource(null));

describe('buildRequest', () => {
  it('builds a direct GET request with Bearer auth', () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'sk-abc',
      path: '/models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
    expect(req.method).toBe('GET');
    expect(req.headers.get('Authorization')).toBe('Bearer sk-abc');
    expect(req.headers.get('x-chatsundere-authorization')).toBeNull();
  });

  it('builds a direct POST request with JSON body', async () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'sk-abc',
      path: '/chat/completions',
      method: 'POST',
      body: { model: 'm', messages: [] },
    });
    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(await req.json()).toEqual({ model: 'm', messages: [] });
  });

  it('cors-proxy routing attaches the account token and target', () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt-abc',
      refreshToken: async () => null,
    });
    const req = buildRequest({
      provider: proxyConfig,
      apiKey: 'upstream-key',
      path: '/v1/chat/completions',
      method: 'POST',
      body: {},
    });
    expect(req.url).toBe('https://proxy.example/v1/chat/completions');
    expect(req.headers.get('x-chatsundere-authorization')).toBe('Bearer jwt-abc');
    expect(req.headers.get('x-cors-proxy-target')).toBe(proxyConfig.baseUrl);
    expect(req.headers.get('Authorization')).toBe('Bearer upstream-key');
    expect(req.headers.get('x-cors-proxy-api-key')).toBeNull();
    expect(req.redirect).toBe('manual');
  });

  it('cors-proxy target is a bare origin and the base path rides on the request (path-bearing baseUrl)', () => {
    // Regression: a `requires-proxy` provider whose baseUrl carries a path (e.g.
    // xai `https://api.x.ai/v1`, wafer `https://pass.wafer.ai/v1`) must send the
    // proxy target as a BARE ORIGIN — apps/proxy-service `parseTarget` refuses a
    // target with a path (400 bad_target). The `/v1` base path instead rides on
    // the proxied request line so the proxy reconstructs the full upstream URL.
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt-abc',
      refreshToken: async () => null,
    });
    const req = buildRequest({
      provider: { baseUrl: 'https://api.x.ai/v1', routing: { kind: 'cors-proxy' } },
      apiKey: 'upstream-key',
      path: '/chat/completions',
      method: 'POST',
      body: {},
    });
    expect(req.headers.get('x-cors-proxy-target')).toBe('https://api.x.ai');
    expect(req.url).toBe('https://proxy.example/v1/chat/completions');
  });

  it('cors-proxy routing throws a typed ProxyUnavailableError without a registered source or token', () => {
    setProxyAuthSource(null);
    expect(() =>
      buildRequest({ provider: proxyConfig, apiKey: 'k', path: '/p', method: 'GET' }),
    ).toThrow(/no proxy is available/);
    try {
      buildRequest({ provider: proxyConfig, apiKey: 'k', path: '/p', method: 'GET' });
      expect.unreachable('buildRequest should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ProxyUnavailableError);
      expect((error as ProxyUnavailableError).missing).toBe('proxy_url');
    }

    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => null,
      refreshToken: async () => null,
    });
    expect(() =>
      buildRequest({ provider: proxyConfig, apiKey: 'k', path: '/p', method: 'GET' }),
    ).toThrow(/no account token/);
    try {
      buildRequest({ provider: proxyConfig, apiKey: 'k', path: '/p', method: 'GET' });
      expect.unreachable('buildRequest should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ProxyUnavailableError);
      expect((error as ProxyUnavailableError).missing).toBe('account_token');
    }
  });

  it('redactRequestHeaders strips x-chatsundere-authorization', () => {
    const headers = new Headers({
      'x-chatsundere-authorization': 'Bearer secret',
      'content-type': 'application/json',
    });
    expect('x-chatsundere-authorization' in redactRequestHeaders(headers)).toBe(false);
  });

  it('direct routing never consults the proxy source', () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example',
      getToken: () => 'jwt',
      refreshToken: async () => null,
    });
    const req = buildRequest({ provider: directConfig, apiKey: 'k', path: '/p', method: 'GET' });
    expect(req.headers.get('x-chatsundere-authorization')).toBeNull();
    expect(req.redirect).toBe('follow');
  });

  it('joins baseUrl + path correctly when baseUrl has trailing slash', () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://nano-gpt.com/api/v1/', routing: { kind: 'direct' } },
      apiKey: 'k',
      path: '/models',
      method: 'GET',
    });
    expect(req.url).toBe('https://nano-gpt.com/api/v1/models');
  });

  it('joins baseUrl + path correctly when path has no leading slash', () => {
    const req = buildRequest({
      provider: { baseUrl: 'https://nano-gpt.com/api/v1', routing: { kind: 'direct' } },
      apiKey: 'k',
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

describe('header auth scheme', () => {
  const eleven: ProviderConfig = {
    baseUrl: 'https://api.elevenlabs.io/v1',
    routing: { kind: 'direct' },
    auth: { header: 'xi-api-key' },
  };

  it('buildRequest uses the xi-api-key header and no Authorization when the scheme says so', () => {
    const req = buildRequest({ provider: eleven, apiKey: 'k', path: '/models', method: 'GET' });
    expect(req.headers.get('xi-api-key')).toBe('k');
    expect(req.headers.get('authorization')).toBeNull();
  });

  it('buildRequest keeps Bearer Authorization when no scheme is given', () => {
    const req = buildRequest({
      provider: directConfig,
      apiKey: 'k',
      path: '/models',
      method: 'GET',
    });
    expect(req.headers.get('authorization')).toBe('Bearer k');
  });

  it('buildRequest applies a prefix when the scheme carries one', () => {
    const req = buildRequest({
      provider: { ...directConfig, auth: { header: 'X-Api-Key', prefix: 'Token' } },
      apiKey: 'k',
      path: '/models',
      method: 'GET',
    });
    expect(req.headers.get('x-api-key')).toBe('Token k');
    expect(req.headers.get('authorization')).toBeNull();
  });

  it('redactRequestHeaders drops xi-api-key', () => {
    const headers = new Headers({ 'xi-api-key': 'secret', accept: 'x' });
    expect('xi-api-key' in redactRequestHeaders(headers)).toBe(false);
  });

  it("every built-in provider's auth header is redacted", () => {
    registerBuiltinProviders();
    for (const p of listProviders()) {
      if (p.auth) expect(SECRET_REQUEST_HEADERS.has(p.auth.header.toLowerCase())).toBe(true);
    }
  });
});
