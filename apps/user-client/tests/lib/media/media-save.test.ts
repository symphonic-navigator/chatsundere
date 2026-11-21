// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { addMediaArtefact } from '../../../src/data/media-artefacts.js';
import {
  type MediaSaveContext,
  _setMediaProbeForTests,
  isExpired,
  progressKey,
  saveMedia,
} from '../../../src/lib/media/media-save.js';
import type { MediaRef } from '../../../src/mcp/media-extract.js';
import { useMediaProgress } from '../../../src/state/media-progress.store.js';

const SIGNED_URL = 'https://cdn.example/out/a.mp3?X-Amz-Expires=600&X-Amz-Signature=deadbeef';
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64]);

const CTX: MediaSaveContext = {
  chatId: 'c1',
  personaId: 'p1',
  serverName: 'ElevenLabs',
  toolName: 'generate_speech',
  title: 'Birdsong',
};

let keySeq = 0;
function urlRef(over: Partial<MediaRef> = {}): MediaRef {
  keySeq += 1;
  return {
    key: `url:https://cdn.example/out/a-${keySeq}.mp3`,
    kind: 'audio',
    mime: 'audio/mpeg',
    source: { kind: 'url', url: SIGNED_URL },
    expiresAt: null,
    providerName: null,
    ...over,
  };
}

const fetchMock = vi.fn<typeof fetch>();

/** A fetched Response's final URL after redirects; constructed ones have none. */
function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  _setMediaProbeForTests(async () => ({ durationMs: 1000, poster: null }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  setProxyAuthSource(null);
  _setMediaProbeForTests(null);
  await _resetClientDataDbForTests();
});

describe('isExpired', () => {
  it('is true once the expiry has passed', () => {
    expect(isExpired({ expiresAt: 1000 }, 2000)).toBe(true);
  });
  it('is false without an expiry', () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
  });
  it('is false before the expiry', () => {
    expect(isExpired({ expiresAt: 3000 }, 2000)).toBe(false);
  });
});

describe('saveMedia', () => {
  it('fails an expired ref as expired without fetching', async () => {
    const outcome = await saveMedia(urlRef({ expiresAt: Date.now() - 1000 }), CTX);
    expect(outcome).toEqual({ status: 'failed', cause: 'expired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves a direct fetch, with a GET that follows redirects', async () => {
    fetchMock.mockResolvedValueOnce(new Response(MP3, { status: 200 }));
    const ref = urlRef();
    const outcome = await saveMedia(ref, CTX);
    expect(outcome.status).toBe('saved');
    const req = fetchMock.mock.calls[0]?.[0] as Request;
    expect(req.method).toBe('GET');
    expect(req.redirect).toBe('follow');
    expect(req.url).toBe(SIGNED_URL);
    if (outcome.status !== 'saved') throw new Error('unreachable');
    const row = await getClientDataDb().artefacts.get(outcome.artefactId);
    expect(row?.kind).toBe('audio');
    expect(row?.title).toBe('Birdsong');
    expect(row?.mediaMeta).toEqual({
      key: ref.key,
      durationMs: 1000,
      serverName: 'ElevenLabs',
      toolName: 'generate_speech',
    });
    expect(JSON.stringify(outcome)).not.toContain('Signature=');
  });

  it('falls back to one proxied fetch when the direct fetch fails CORS', async () => {
    setProxyAuthSource({
      getUrl: () => 'https://proxy.example/cors/',
      getToken: () => 'tok-1',
      refreshToken: async () => null,
    });
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(MP3, { status: 200 }));
    const outcome = await saveMedia(urlRef(), CTX);
    expect(outcome.status).toBe('saved');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const proxied = fetchMock.mock.calls[1]?.[0] as Request;
    expect(proxied.method).toBe('GET');
    expect(proxied.redirect).toBe('manual');
    expect(proxied.url).toBe(
      'https://proxy.example/cors/out/a.mp3?X-Amz-Expires=600&X-Amz-Signature=deadbeef',
    );
    expect(proxied.headers.get('x-cors-proxy-target')).toBe('https://cdn.example');
    expect(proxied.headers.get('x-cors-proxy-kind')).toBe('mcp');
    expect(proxied.headers.get('x-chatsundere-authorization')).toBe('Bearer tok-1');
  });

  it('is unreachable when the direct fetch fails and no proxy is linked', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const outcome = await saveMedia(urlRef(), CTX);
    expect(outcome).toEqual({ status: 'failed', cause: 'unreachable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a 403 close to the expiry as expired', async () => {
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    const ref = urlRef({ expiresAt: Date.now() + 30_000 });
    expect(isExpired(ref, Date.now())).toBe(false);
    expect(await saveMedia(ref, CTX)).toEqual({ status: 'failed', cause: 'expired' });
  });

  it('reads a 403 far from any expiry as unreachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    expect(await saveMedia(urlRef({ expiresAt: Date.now() + 3_600_000 }), CTX)).toEqual({
      status: 'failed',
      cause: 'unreachable',
    });
  });

  it('reads any other non-OK status as unreachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect(await saveMedia(urlRef(), CTX)).toEqual({ status: 'failed', cause: 'unreachable' });
  });

  it('refuses a direct redirect that ends off https, cancelling the body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(MP3), cancel });
    fetchMock.mockResolvedValueOnce(withUrl(new Response(body), 'http://cdn.example/a.mp3'));
    expect(await saveMedia(urlRef(), CTX)).toEqual({ status: 'failed', cause: 'unreachable' });
    expect(cancel).toHaveBeenCalled();
    expect(await getClientDataDb().artefacts.count()).toBe(0);
  });

  it('saves a direct redirect that ends on another https host', async () => {
    fetchMock.mockResolvedValueOnce(
      withUrl(new Response(MP3), 'https://other-cdn.example/blob/a.mp3'),
    );
    expect((await saveMedia(urlRef(), CTX)).status).toBe('saved');
  });

  it('reads an unfollowed redirect as unreachable', async () => {
    fetchMock.mockResolvedValueOnce(Response.redirect('https://elsewhere.example/', 302));
    expect(await saveMedia(urlRef(), CTX)).toEqual({ status: 'failed', cause: 'unreachable' });
  });

  it('refuses an HTML body that claims to be audio, writing nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html><p>sign in</p>', { status: 200 }));
    expect(await saveMedia(urlRef(), CTX)).toEqual({ status: 'failed', cause: 'wrong-type' });
    expect(await getClientDataDb().artefacts.count()).toBe(0);
  });

  it('refuses a body announced above 200 MiB and cancels it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(MP3);
      },
      cancel,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-length': String(210 * 1024 * 1024) } }),
    );
    expect(await saveMedia(urlRef(), CTX)).toEqual({ status: 'failed', cause: 'too-large' });
    expect(cancel).toHaveBeenCalled();
    expect(await getClientDataDb().artefacts.count()).toBe(0);
  });

  it('joins a second call for the same key while the first runs', async () => {
    let resolve: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const ref = urlRef();
    const first = saveMedia(ref, CTX);
    const second = saveMedia(ref, CTX);
    expect(second).toBe(first);
    // Let the first call reach its fetch before answering it.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolve(new Response(MP3, { status: 200 }));
    const outcome = await first;
    expect(outcome.status).toBe('saved');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Settled: a later call starts afresh (and now finds the duplicate).
    expect(saveMedia(ref, CTX)).not.toBe(first);
  });

  it('never joins the same key across two chats', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(MP3, { status: 200 }))
      .mockResolvedValueOnce(new Response(MP3, { status: 200 }));
    const ref = urlRef();
    const a = saveMedia(ref, CTX);
    const b = saveMedia(ref, { ...CTX, chatId: 'c2' });
    expect(b).not.toBe(a);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe('saved');
    expect(rb.status).toBe('saved');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers duplicate for a key already saved in this chat, without fetching', async () => {
    const ref = urlRef();
    const existing = await addMediaArtefact({
      chatId: 'c1',
      personaId: 'p1',
      key: ref.key,
      kind: 'audio',
      mime: 'audio/mpeg',
      title: 'Earlier',
      bytes: new Blob([MP3]),
      probe: { durationMs: null, poster: null },
      serverName: 's',
      toolName: 't',
    });
    expect(await saveMedia(ref, CTX)).toEqual({ status: 'duplicate', artefactId: existing });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves a bytes ref without fetching', async () => {
    const base64 = btoa(String.fromCharCode(...MP3));
    const outcome = await saveMedia(urlRef({ source: { kind: 'bytes', base64 } }), CTX);
    expect(outcome.status).toBe('saved');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still saves when the probe fails', async () => {
    _setMediaProbeForTests(async () => {
      throw new Error('no media element');
    });
    fetchMock.mockResolvedValueOnce(new Response(MP3, { status: 200 }));
    const outcome = await saveMedia(urlRef(), CTX);
    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') throw new Error('unreachable');
    const row = await getClientDataDb().artefacts.get(outcome.artefactId);
    expect(row?.mediaMeta?.durationMs).toBeNull();
  });

  it('clears the progress entry once settled', async () => {
    fetchMock.mockResolvedValueOnce(new Response(MP3, { status: 200 }));
    const ref = urlRef();
    await saveMedia(ref, CTX);
    expect(useMediaProgress.getState().byKey[progressKey('c1', ref.key)]).toBeUndefined();
  });

  it('never puts the URL into any failure outcome', async () => {
    const refs = [
      urlRef({ expiresAt: 1 }),
      urlRef(),
      urlRef(),
      urlRef({ expiresAt: Date.now() + 10_000 }),
    ];
    fetchMock
      .mockRejectedValueOnce(new TypeError(`Failed to fetch ${SIGNED_URL}`))
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    for (const ref of refs) {
      const outcome = await saveMedia(ref, CTX);
      expect(outcome.status).toBe('failed');
      expect(JSON.stringify(outcome)).not.toContain('Signature=');
    }
  });
});
