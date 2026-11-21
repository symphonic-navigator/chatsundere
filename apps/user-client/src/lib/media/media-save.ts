// SPDX-License-Identifier: AGPL-3.0-only
import { fetchWithProxyAuth, getProxyAuthSource, isOpaqueRedirect } from '@chatsundere/llm-unified';
import { addMediaArtefact, findMediaArtefactByKey } from '../../data/media-artefacts.js';
import type { MediaKind, MediaRef } from '../../mcp/media-extract.js';
import { useMediaProgress } from '../../state/media-progress.store.js';
import { type MediaProbe, probeMedia } from './media-probe.js';
import { sniffAgrees, sniffMediaMime } from './media-sniff.js';

export type MediaFailCause = 'expired' | 'unreachable' | 'wrong-type' | 'too-large';
export type MediaSaveOutcome =
  | { status: 'saved'; artefactId: string }
  | { status: 'duplicate'; artefactId: string }
  | { status: 'failed'; cause: MediaFailCause };

export interface MediaSaveContext {
  chatId: string;
  personaId: string;
  serverName: string;
  toolName: string;
  title: string;
}

/** Fetched bodies and decoded base64 are always ArrayBuffer-backed, never shared memory. */
type Bytes = Uint8Array<ArrayBuffer>;

const MAX_BYTES = 200 * 1024 * 1024;
const SNIFF_BYTES = 64;
/** A signed URL refused this close to its expiry has most likely just lapsed. */
const EXPIRY_GRACE_MS = 60_000;

type Probe = (blob: Blob, kind: MediaKind) => Promise<MediaProbe>;
let probe: Probe = probeMedia;

/** Swap the media probe (tests run without media elements); null restores the real one. */
export function _setMediaProbeForTests(next: Probe | null): void {
  probe = next ?? probeMedia;
}

/** True once a ref's signed URL has passed its expiry. */
export function isExpired(ref: Pick<MediaRef, 'expiresAt'>, now: number = Date.now()): boolean {
  return ref.expiresAt !== null && ref.expiresAt <= now;
}

const inFlight = new Map<string, Promise<MediaSaveOutcome>>();

/** The in-flight and `useMediaProgress` key of one save: per chat, so two chats never join. */
export function progressKey(chatId: string, key: string): string {
  return `${chatId}\u0000${key}`;
}

/**
 * The save of `key` still running in this chat, to join without starting one; null when
 * none is. Inline bytes cannot be fetched again, so a card can only wait on the tool's save.
 */
export function awaitInFlightSave(chatId: string, key: string): Promise<MediaSaveOutcome> | null {
  return inFlight.get(progressKey(chatId, key)) ?? null;
}

/** Single-flight per chat and `ref.key`: a second call while one runs joins it. */
export function saveMedia(
  ref: MediaRef,
  ctx: MediaSaveContext,
  signal?: AbortSignal,
): Promise<MediaSaveOutcome> {
  const pkey = progressKey(ctx.chatId, ref.key);
  const running = inFlight.get(pkey);
  if (running) return running;
  const promise = runSave(ref, ctx, pkey, signal).finally(() => {
    inFlight.delete(pkey);
    useMediaProgress.getState().clear(pkey);
  });
  inFlight.set(pkey, promise);
  return promise;
}

class SaveFailure extends Error {
  constructor(readonly failCause: MediaFailCause) {
    super(failCause);
  }
}

async function runSave(
  ref: MediaRef,
  ctx: MediaSaveContext,
  pkey: string,
  signal: AbortSignal | undefined,
): Promise<MediaSaveOutcome> {
  const existing = await findMediaArtefactByKey(ctx.chatId, ref.key);
  if (existing) return { status: 'duplicate', artefactId: existing.id };
  if (isExpired(ref)) return { status: 'failed', cause: 'expired' };

  let bytes: Bytes;
  try {
    bytes =
      ref.source.kind === 'bytes'
        ? checkBytes(decodeBase64(ref.source.base64), ref.mime)
        : await download(ref, ref.source.url, pkey, signal);
  } catch (e) {
    // Only the cause leaves this function: fetch errors can carry the signed URL.
    return { status: 'failed', cause: e instanceof SaveFailure ? e.failCause : 'unreachable' };
  }

  const blob = new Blob([bytes], { type: ref.mime });
  const probed = await probe(blob, ref.kind).catch(
    (): MediaProbe => ({ durationMs: null, poster: null }),
  );
  const artefactId = await addMediaArtefact({
    chatId: ctx.chatId,
    personaId: ctx.personaId,
    key: ref.key,
    kind: ref.kind,
    mime: ref.mime,
    title: ctx.title,
    bytes: blob,
    probe: probed,
    serverName: ctx.serverName,
    toolName: ctx.toolName,
  });
  return { status: 'saved', artefactId };
}

function decodeBase64(base64: string): Bytes {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new SaveFailure('wrong-type');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function checkBytes(bytes: Bytes, mime: string): Bytes {
  if (bytes.length > MAX_BYTES) throw new SaveFailure('too-large');
  if (!sniffAgrees(mime, sniffMediaMime(bytes.subarray(0, SNIFF_BYTES))))
    throw new SaveFailure('wrong-type');
  return bytes;
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/** Proxy route as for MCP requests (mcp-client.ts), but a plain GET. Null when no proxy is linked. */
function buildProxiedRequest(target: URL): (() => Request) | null {
  const source = getProxyAuthSource();
  if (source?.getUrl() == null || source.getToken() == null) return null;
  return () => {
    const proxyUrl = source.getUrl();
    const token = source.getToken();
    if (proxyUrl === null || token === null) throw new SaveFailure('unreachable');
    const headers = new Headers({
      'x-chatsundere-authorization': `Bearer ${token}`,
      'x-cors-proxy-target': target.origin,
      'x-cors-proxy-kind': 'mcp',
    });
    return new Request(joinUrl(proxyUrl, target.pathname + target.search), {
      method: 'GET',
      headers,
      redirect: 'manual',
    });
  };
}

async function fetchMedia(url: string, signal: AbortSignal | undefined): Promise<Response> {
  const init = signal ? { signal } : undefined;
  try {
    // File hosts routinely redirect to a CDN, so redirects are followed; `download`
    // refuses a final URL that left https (spec §5).
    return await fetch(new Request(url, { method: 'GET', redirect: 'follow' }), init);
  } catch (e) {
    if (!(e instanceof TypeError) || signal?.aborted) throw new SaveFailure('unreachable');
    // A TypeError is most often CORS: the file host does not allow this origin.
    const build = buildProxiedRequest(new URL(url));
    if (!build) throw new SaveFailure('unreachable');
    return fetchWithProxyAuth(build, { proxied: true, ...(signal ? { signal } : {}) });
  }
}

async function download(
  ref: MediaRef,
  url: string,
  pkey: string,
  signal: AbortSignal | undefined,
): Promise<Bytes> {
  const response = await fetchMedia(url, signal);
  // The proxied route never follows, so its redirects arrive opaque.
  if (isOpaqueRedirect(response)) throw new SaveFailure('unreachable');
  if (!isHttpsOrUnset(response.url)) {
    await response.body?.cancel().catch(() => undefined);
    throw new SaveFailure('unreachable');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const nearExpiry = ref.expiresAt !== null && ref.expiresAt - Date.now() <= EXPIRY_GRACE_MS;
    throw new SaveFailure(response.status === 403 && nearExpiry ? 'expired' : 'unreachable');
  }

  const lengthHeader = Number(response.headers.get('content-length'));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
  if (total !== null && total > MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new SaveFailure('too-large');
  }
  if (!response.body) throw new SaveFailure('unreachable');

  const progress = useMediaProgress.getState();
  const reader = response.body.getReader();
  const chunks: Bytes[] = [];
  let done = 0;
  let sniffed = false;
  progress.set(pkey, 0, total);
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      done += next.value.length;
      if (done > MAX_BYTES) throw new SaveFailure('too-large');
      // Sniff as soon as the head is in, so a sign-in page is not downloaded whole.
      if (!sniffed && done >= SNIFF_BYTES) {
        sniffed = true;
        if (!sniffAgrees(ref.mime, sniffMediaMime(concat(chunks, done).subarray(0, SNIFF_BYTES))))
          throw new SaveFailure('wrong-type');
      }
      progress.set(pkey, done, total);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
  const bytes = concat(chunks, done);
  if (!sniffed) checkBytes(bytes, ref.mime);
  return bytes;
}

/** A constructed Response carries no URL; a fetched one always does. */
function isHttpsOrUnset(url: string): boolean {
  if (url === '') return true;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function concat(chunks: Bytes[], length: number): Bytes {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
