// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DB_NAME,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db';
import { decodeCallbackPayload } from '../../../src/mcp/oauth/callback-payload';
import {
  type CallbackDeps,
  type CallbackView,
  mountPage,
  runCallback,
} from '../../../src/oauth-callback/main';
import {
  CLIENT_DATA_DB_NAME,
  type PendingPresence,
  checkPendingState,
} from '../../../src/oauth-callback/pending-check';

type Listener = (e: { data: unknown }) => void;

function setup(
  search: string,
  opts: { ackOnPost?: boolean; ackState?: string; presence?: PendingPresence } = {},
) {
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
    ...(opts.presence ? { checkState: async () => opts.presence as PendingPresence } : {}),
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
    expect(view.foreign).toBe(false);
    expect(view.issHost).toBeNull();
    expect(t.deps.close).not.toHaveBeenCalled();
  });

  it('names the sign-in host from iss on the code view', async () => {
    const t = setup('?code=abc&state=st1&iss=https%3A%2F%2Flogin.kumbu.example%2Fo');
    const p = runCallback(t.deps);
    t.expire();
    await p;
    expect(t.views.at(-1)).toMatchObject({ view: 'code', issHost: 'login.kumbu.example' });
  });

  it('marks the code foreign only when this browser certainly did not start the sign-in', async () => {
    for (const [presence, foreign] of [
      ['absent', true],
      ['present', false],
      ['unknown', false],
    ] as const) {
      const t = setup('?code=abc&state=st1', { presence });
      const p = runCallback(t.deps);
      t.expire();
      await p;
      expect(t.views.at(-1)).toMatchObject({ view: 'code', foreign });
    }
  });

  it('treats a failing presence check as unknown', async () => {
    const t = setup('?code=abc&state=st1');
    t.deps.checkState = async () => {
      throw new Error('storage gone');
    };
    const p = runCallback(t.deps);
    t.expire();
    await p;
    expect(t.views.at(-1)).toMatchObject({ view: 'code', foreign: false });
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

  it('reports any other error as a sign-in that did not finish', async () => {
    for (const error of ['server_error', 'unauthorized_client', 'invalid_scope']) {
      const t = setup(`?error=${error}&state=st1`);
      const p = runCallback(t.deps);
      t.expire();
      await p;
      const view = t.views.at(-1);
      expect(view?.view).toBe('failed');
      if (view?.view !== 'failed' || view.paste === null) throw new Error('unreachable');
      expect(decodeCallbackPayload(view.paste)).toEqual({ error, state: 'st1' });
    }
  });

  it('needs no paste once a refusal has been acknowledged', async () => {
    const t = setup('?error=access_denied&state=st1', { ackOnPost: true });
    await runCallback(t.deps);
    expect(t.views.at(-1)).toEqual({ view: 'cancelled', paste: null });
  });

  it('says there is nothing to finish, without posting, when there is no state', async () => {
    const t = setup('?code=abc');
    await runCallback(t.deps);
    expect(t.views.at(-1)).toEqual({ view: 'empty' });
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
    expect(html).toContain("Sign-in didn't finish");
    expect(html).toContain('Signed in. Return to Chatsundere to finish.');
    expect(html).toContain('This sign-in page has nothing to finish. Go back to Chatsundere.');
    expect(html).not.toContain("You're connected");
    expect(html).toContain('starting again is fine');
  });

  function mount() {
    document.body.innerHTML = html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);
    const root = document.getElementById('oauth-callback') as HTMLElement;
    return { root, render: mountPage(root) };
  }
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element | null): boolean => {
    for (let n = el as HTMLElement | null; n; n = n.parentElement) if (n.hidden) return false;
    return el !== null;
  };

  it('warns, before the Copy button, never to send the code on, naming the iss host', () => {
    const { root, render } = mount();
    render({ view: 'code', paste: 'csm1.x', issHost: 'login.kumbu.example', foreign: false });
    const warning = root.querySelector('[data-warning-here]');
    expect(visible(warning)).toBe(true);
    expect(text(warning)).toBe(
      'Only paste this into Chatsundere on this device, where you just started signing in to login.kumbu.example. Never send it to anyone, including support.',
    );
    const copy = root.querySelector('[data-code-block] [data-copy]');
    expect(visible(copy)).toBe(true);
    // The warning precedes the button in document order.
    expect(
      (warning as Node).compareDocumentPosition(copy as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(visible(root.querySelector('[data-foreign]'))).toBe(false);
  });

  it('leaves the host out of the warning when the redirect carries no iss', () => {
    const { root, render } = mount();
    render({ view: 'code', paste: 'csm1.x', issHost: null, foreign: false });
    const phrase = root.querySelector('[data-warning-here] [data-iss-phrase]');
    expect(visible(phrase)).toBe(false);
  });

  it('hides a foreign code behind a deliberate step with the stronger warning', () => {
    const { root, render } = mount();
    render({ view: 'code', paste: 'csm1.x', issHost: 'login.kumbu.example', foreign: true });
    const foreign = root.querySelector('[data-foreign]');
    expect(visible(foreign)).toBe(true);
    expect(text(foreign)).toContain(
      "This sign-in wasn't started in Chatsundere in this browser. If someone sent you the sign-in link, close this page.",
    );
    expect(visible(root.querySelector('textarea[aria-label="Sign-in code"]'))).toBe(false);
    expect(visible(root.querySelector('[data-code-block] [data-copy]'))).toBe(false);
    (root.querySelector('[data-reveal]') as HTMLButtonElement).click();
    expect(text(root.querySelector('[data-reveal]'))).toBe('I started this on another device');
    expect(visible(root.querySelector('textarea[aria-label="Sign-in code"]'))).toBe(true);
    expect(visible(root.querySelector('[data-warning-elsewhere]'))).toBe(true);
    expect(text(root.querySelector('[data-warning-elsewhere]'))).toContain(
      'Never send it to anyone, including support.',
    );
  });

  it('writes the iss host as text, never as markup', () => {
    const { root, render } = mount();
    render({ view: 'code', paste: 'csm1.x', issHost: '<img src=x>', foreign: false });
    expect(root.querySelector('[data-iss-host] img')).toBeNull();
  });
});

describe('checkPendingState', () => {
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('uses the app database name', () => {
    expect(CLIENT_DATA_DB_NAME).toBe(DB_NAME);
  });

  it('finds a pending sign-in the app stored, and reports another state absent', async () => {
    const db = await openClientDataDb();
    await db.mcpOAuthPending.put({
      state: 'st-here',
      sealed: { v: 1 } as never,
      serverId: 's1',
      createdAt: 1,
    });
    expect(await checkPendingState(indexedDB, 'st-here')).toBe('present');
    expect(await checkPendingState(indexedDB, 'st-other')).toBe('absent');
  });

  it('is unknown without the database, and never creates it', async () => {
    const idb = new IDBFactory();
    expect(await checkPendingState(idb, 'st1')).toBe('unknown');
    const names = (await idb.databases()).map((d) => d.name);
    expect(names).not.toContain(CLIENT_DATA_DB_NAME);
  });

  it('is unknown when the database has no pending table yet', async () => {
    const idb = new IDBFactory();
    await new Promise<void>((res, rej) => {
      const r = idb.open(CLIENT_DATA_DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('other');
      r.onsuccess = () => {
        r.result.close();
        res();
      };
      r.onerror = () => rej(r.error);
    });
    expect(await checkPendingState(idb, 'st1')).toBe('unknown');
  });

  it('is unknown without IndexedDB at all', async () => {
    expect(await checkPendingState(undefined, 'st1')).toBe('unknown');
  });
});

describe('callback page bundle', () => {
  it.each([
    'src/oauth-callback/main.ts',
    'src/oauth-callback/pending-check.ts',
    'src/mcp/oauth/callback-payload.ts',
  ])('%s imports nothing from @chatsundere/ or Dexie (keeps the page chunk tiny)', (rel) => {
    const src = readFileSync(resolve(__dirname, '../../..', rel), 'utf-8');
    expect(src).not.toMatch(/from\s+['"]@chatsundere\//);
    expect(src).not.toMatch(/from\s+['"]dexie/);
    expect(src).not.toMatch(/boot\/client-data-db/);
  });
});
