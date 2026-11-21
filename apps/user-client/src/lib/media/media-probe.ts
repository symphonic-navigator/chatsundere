// SPDX-License-Identifier: AGPL-3.0-only
import type { MediaKind } from '../../mcp/media-extract.js';

export interface MediaProbe {
  durationMs: number | null;
  poster: { blob: Blob; width: number; height: number } | null;
}

const NOTHING: MediaProbe = { durationMs: null, poster: null };
const PROBE_TIMEOUT_MS = 8000;
const POSTER_MAX_WIDTH = 640;
const POSTER_SEEK_S = 0.1;

export interface MediaProbeDeps {
  doc?: Document;
  timeoutMs?: number;
}

function once(el: HTMLMediaElement, ok: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      el.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = () => {
      el.removeEventListener(ok, onOk);
      reject(new Error('media element error'));
    };
    el.addEventListener(ok, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

async function grabPoster(video: HTMLVideoElement, doc: Document): Promise<MediaProbe['poster']> {
  const seeked = once(video, 'seeked');
  video.currentTime = Number.isFinite(video.duration)
    ? Math.min(POSTER_SEEK_S, video.duration)
    : POSTER_SEEK_S;
  await seeked;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const width = Math.min(vw, POSTER_MAX_WIDTH);
  const height = Math.round((vh * width) / vw);
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82),
  );
  return blob ? { blob, width, height } : null;
}

async function runProbe(
  el: HTMLMediaElement,
  url: string,
  kind: MediaKind,
  doc: Document,
): Promise<MediaProbe> {
  el.muted = true;
  el.preload = 'metadata';
  const loaded = once(el, 'loadedmetadata');
  el.src = url;
  await loaded;
  const durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : null;
  let poster: MediaProbe['poster'] = null;
  if (kind === 'video') {
    // A missing poster is not a failed probe: the duration still counts.
    poster = await grabPoster(el as HTMLVideoElement, doc).catch(() => null);
  }
  return { durationMs, poster };
}

/** Read duration (and, for video, a JPEG poster ≤ 640 px wide) off-screen; nulls on any failure or after 8 s. */
export async function probeMedia(
  blob: Blob,
  kind: MediaKind,
  deps: MediaProbeDeps = {},
): Promise<MediaProbe> {
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) return NOTHING;
  let el: HTMLMediaElement;
  let url: string;
  try {
    el = doc.createElement(kind);
    url = URL.createObjectURL(blob);
  } catch {
    return NOTHING;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<MediaProbe>((resolve) => {
    timer = setTimeout(() => resolve(NOTHING), deps.timeoutMs ?? PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([runProbe(el, url, kind, doc).catch(() => NOTHING), timeout]);
  } finally {
    clearTimeout(timer);
    // Released on timeout too, so a stalled element does not pin the bytes.
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(url);
  }
}
