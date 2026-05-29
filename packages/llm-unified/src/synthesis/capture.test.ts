import { describe, expect, it } from 'bun:test';
import { runProbe } from './capture.js';
import type { Probe } from './fixture-types.js';

const probe: Probe = { id: 'p', dimension: 'reasoning-on', body: { model: 'm', messages: [] } };

describe('runProbe', () => {
  it('captures status and raw body verbatim', async () => {
    const fetchFn = async () => new Response('data: {"x":1}\n\ndata: [DONE]\n\n', { status: 200 });
    const fx = await runProbe({
      baseUrl: 'https://nano-gpt.com/api/v1',
      apiKey: 'k',
      probe,
      fetchFn,
    });
    expect(fx.status).toBe(200);
    expect(fx.rawResponse).toContain('"x":1');
    expect(fx.requestBody).toEqual({ model: 'm', messages: [] });
    expect(fx.dimension).toBe('reasoning-on');
  });

  it('captures error bodies without throwing', async () => {
    const fetchFn = async () => new Response('{"error":"bad effort"}', { status: 400 });
    const fx = await runProbe({ baseUrl: 'b', apiKey: 'k', probe, fetchFn });
    expect(fx.status).toBe(400);
    expect(fx.rawResponse).toContain('bad effort');
  });
});
