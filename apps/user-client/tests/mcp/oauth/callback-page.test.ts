// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeCallbackPayload } from '../../../src/mcp/oauth/callback-payload';
import {
  type CallbackDeps,
  type CallbackView,
  runCallback,
} from '../../../src/oauth-callback/main';

type Listener = (e: { data: unknown }) => void;

function setup(search: string, opts: { ackOnPost?: boolean; ackState?: string } = {}) {
  const calls: string[] = [];
  const views: CallbackView[] = [];
  const posted: unknown[] = [];
  let listener: Listener | null = null;
  let release: () => void = () => {};
  const state = new URLSearchParams(search).get('state') ?? '';
  const channel = {
    postMessage: (m: unknown) => {
      calls.push('post');
      posted.push(m);
      if (opts.ackOnPost) {
        // An acknowledgement arrives while the page is still waiting.
        queueMicrotask(() => {
          listener?.({ data: { type: 'ack', state: opts.ackState ?? state } });
          release();
        });
      }
    },
    set onmessage(l: Listener | null) {
      listener = l;
    },
    get onmessage() {
      return listener;
    },
    close: () => {},
  };
  const waits: number[] = [];
  const deps = {
    location: { search, pathname: '/oauth/callback' } as Location,
    history: {
      replaceState: vi.fn(() => {
        calls.push('replace');
      }),
    } as unknown as History,
    // A plain object stands in for the browser's MessageEvent plumbing.
    channel: channel as unknown as CallbackDeps['channel'],
    render: (v: CallbackView) => {
      calls.push('render');
      views.push(v);
    },
    close: vi.fn(),
    wait: (ms: number) => {
      waits.push(ms);
      return new Promise<void>((res) => {
        release = res;
      });
    },
  };
  return {
    deps,
    views,
    posted,
    calls,
    waits,
    ack: (s = state) => listener?.({ data: { type: 'ack', state: s } }),
    expire: () => release(),
  };
}

describe('runCallback', () => {
  it('removes the query before doing anything else', async () => {
    const t = setup('?code=abc&state=st1', { ackOnPost: true });
    await runCallback(t.deps);
    expect(t.calls[0]).toBe('replace');
    expect(t.calls.indexOf('replace')).toBeLessThan(t.calls.indexOf('post'));
    expect(t.deps.history.replaceState).toHaveBeenCalledWith(null, '', '/oauth/callback');
  });

  it('shows done and closes once the app acknowledges', async () => {
    const t = setup('?code=abc&state=st1&iss=https%3A%2F%2Fas.example', { ackOnPost: true });
    await runCallback(t.deps);
    expect(t.posted).toEqual([
      { type: 'result', payload: { code: 'abc', state: 'st1', iss: 'https://as.example' } },
    ]);
    expect(t.views.at(-1)).toEqual({ view: 'done' });
    expect(t.deps.close).toHaveBeenCalled();
  });

  it('waits exactly 1.5 seconds for the acknowledgement', async () => {
    const t = setup('?code=abc&state=st1');
    const p = runCallback(t.deps);
    t.expire();
    await p;
    expect(t.waits).toEqual([1500]);
  });

  it('shows the code view with a pasteable payload when nobody acknowledges', async () => {
    const t = setup('?code=abc&state=st1');
    const p = runCallback(t.deps);
    t.expire();
    await p;
    const view = t.views.at(-1);
    expect(view?.view).toBe('code');
    if (view?.view !== 'code') throw new Error('unreachable');
    expect(decodeCallbackPayload(view.paste)).toEqual({ code: 'abc', state: 'st1' });
    expect(t.deps.close).not.toHaveBeenCalled();
  });

  it('switches to done when the acknowledgement arrives late', async () => {
    const t = setup('?code=abc&state=st1');
    const p = runCallback(t.deps);
    t.expire();
    await p;
    expect(t.views.at(-1)?.view).toBe('code');
    t.ack();
    expect(t.views.at(-1)).toEqual({ view: 'done' });
  });

  it('ignores an acknowledgement for another sign-in', async () => {
    const t = setup('?code=abc&state=st1');
    const p = runCallback(t.deps);
    t.ack('someone-else');
    t.expire();
    await p;
    expect(t.views.at(-1)?.view).toBe('code');
  });

  it('reports a refusal as cancelled and offers a paste payload', async () => {
    const t = setup('?error=access_denied&state=st1');
    const p = runCallback(t.deps);
    t.expire();
    await p;
    const view = t.views.at(-1);
    expect(view?.view).toBe('cancelled');
    if (view?.view !== 'cancelled' || view.paste === null) throw new Error('unreachable');
    expect(decodeCallbackPayload(view.paste)).toEqual({ error: 'access_denied', state: 'st1' });
    expect(t.posted).toEqual([
      { type: 'result', payload: { error: 'access_denied', state: 'st1' } },
    ]);
  });

  it('needs no paste once a refusal has been acknowledged', async () => {
    const t = setup('?error=access_denied&state=st1', { ackOnPost: true });
    await runCallback(t.deps);
    expect(t.views.at(-1)).toEqual({ view: 'cancelled', paste: null });
  });

  it('shows cancelled without posting when there is no state', async () => {
    const t = setup('?code=abc');
    await runCallback(t.deps);
    expect(t.views.at(-1)).toEqual({ view: 'cancelled', paste: null });
    expect(t.posted).toEqual([]);
    expect(t.calls[0]).toBe('replace');
  });
});

describe('oauth-callback.html', () => {
  const html = readFileSync(resolve(__dirname, '../../../oauth-callback.html'), 'utf-8');

  it('loads nothing third-party', () => {
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html.toLowerCase()).not.toContain('fonts.g');
  });

  it('carries the agreed copy', () => {
    expect(html).toContain('Almost there');
    expect(html).toContain('Copy code');
    expect(html).toContain('Sign-in was cancelled. Go back to Chatsundere to try again');
    expect(html).toContain("You're connected. Return to Chatsundere");
    expect(html).toContain('starting again is fine');
  });
});

describe('callback page bundle', () => {
  it.each(['src/oauth-callback/main.ts', 'src/mcp/oauth/callback-payload.ts'])(
    '%s imports nothing from @chatsundere/ (keeps the page chunk tiny)',
    (rel) => {
      const src = readFileSync(resolve(__dirname, '../../..', rel), 'utf-8');
      expect(src).not.toMatch(/from\s+['"]@chatsundere\//);
    },
  );
});
