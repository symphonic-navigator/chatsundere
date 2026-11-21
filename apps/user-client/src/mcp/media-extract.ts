// SPDX-License-Identifier: AGPL-3.0-only

export type MediaKind = 'audio' | 'video';

export interface MediaRef {
  /** De-dup key: `gen:<generation_id>`, `url:<origin+pathname>` or `bytes:<hash of first 64 base64 chars + length>`. */
  key: string;
  kind: MediaKind;
  /** Allow-listed mime type, from the block, link or field, else from the URL extension. */
  mime: string;
  source: { kind: 'bytes'; base64: string } | { kind: 'url'; url: string };
  /** Milliseconds since epoch, from a signed URL's expiry parameters; null when there are none. */
  expiresAt: number | null;
  /** The `name` of a resource_link, unless it is a generic file name. */
  providerName: string | null;
}

export interface McpRawResult {
  content?: unknown[];
  structuredContent?: unknown;
}

const ALLOWED_MIMES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

const MAX_DEPTH = 8;
const MAX_NODES = 5000;
const MIME_FIELDS = ['mime_type', 'mimeType', 'content_type', 'contentType'];
/** Preferred URL fields first: the full-resolution file beats its preview. */
const PREFERRED_URL_FIELDS = ['full_res_url', 'preview_url', 'url'];

/** True for file names a provider generates rather than a person chose (`content.mp3`, hex or UUID stems). */
export function isGenericFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim().toLowerCase();
  if (stem === 'content') return true;
  return /^[0-9a-f]{8,}$/.test(stem) || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(stem);
}

function normaliseMime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const mime = raw.split(';')[0]?.trim().toLowerCase();
  return mime ? mime : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function extensionOf(url: URL): string | null {
  const last = url.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : null;
}

/** Signed-URL expiry in ms epoch: GCS-style `Expires` (seconds) or S3-style `X-Amz-Date` + `X-Amz-Expires`. */
function expiryOf(url: URL): number | null {
  const expires = url.searchParams.get('Expires');
  if (expires !== null && /^\d+$/.test(expires)) return Number(expires) * 1000;
  const date = url.searchParams.get('X-Amz-Date');
  const lifetime = url.searchParams.get('X-Amz-Expires');
  const match = date ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date) : null;
  if (match && lifetime !== null && /^\d+$/.test(lifetime)) {
    const [, y, mo, d, h, mi, s] = match.map(Number);
    return (
      Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0) + Number(lifetime) * 1000
    );
  }
  return null;
}

/** Cheap non-cryptographic hash (FNV-1a): the key only has to tell blobs apart within one result. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function kindOf(mime: string): MediaKind {
  return mime.startsWith('video/') ? 'video' : 'audio';
}

type Outcome = { ref: MediaRef } | { refused: string } | null;

/** A hint is refusable (rather than merely not media) when it claims audio/video or is SVG, the one image type that can carry script. */
function isRefusableMime(mime: string): boolean {
  return mime.startsWith('audio/') || mime.startsWith('video/') || mime === 'image/svg+xml';
}

function urlOutcome(
  url: URL,
  mimeHint: string | null,
  key: string,
  providerName: string | null,
): Outcome {
  const ext = extensionOf(url);
  if (mimeHint !== null) {
    if (!ALLOWED_MIMES.has(mimeHint)) {
      return isRefusableMime(mimeHint) ? { refused: key } : null;
    }
  } else if (ext === 'svg') {
    return { refused: key };
  }
  const mime = mimeHint ?? (ext !== null ? (MIME_BY_EXTENSION[ext] ?? null) : null);
  if (mime === null) return null;
  return {
    ref: {
      key,
      kind: kindOf(mime),
      mime,
      source: { kind: 'url', url: url.toString() },
      expiresAt: expiryOf(url),
      providerName,
    },
  };
}

function bytesOutcome(base64: unknown, mimeRaw: unknown): Outcome {
  const mime = normaliseMime(mimeRaw);
  if (typeof base64 !== 'string' || base64 === '' || mime === null) return null;
  if (!ALLOWED_MIMES.has(mime)) {
    return isRefusableMime(mime)
      ? { refused: `bytes:${hashOf(base64.slice(0, 64))}:${base64.length}` }
      : null;
  }
  return {
    ref: {
      key: `bytes:${hashOf(base64.slice(0, 64))}:${base64.length}`,
      kind: kindOf(mime),
      mime,
      source: { kind: 'bytes', base64 },
      expiresAt: null,
      providerName: null,
    },
  };
}

class Collector {
  readonly refs: MediaRef[] = [];
  private readonly refusedKeys = new Set<string>();
  private readonly seen = new Set<string>();
  private nodes = 0;

  add(outcome: Outcome): void {
    if (outcome === null) return;
    if ('refused' in outcome) {
      this.refusedKeys.add(outcome.refused);
      return;
    }
    if (this.seen.has(outcome.ref.key)) return;
    this.seen.add(outcome.ref.key);
    this.refs.push(outcome.ref);
  }

  get refused(): number {
    return this.refusedKeys.size;
  }

  walk(value: unknown, depth: number): void {
    if (depth > MAX_DEPTH || this.nodes++ >= MAX_NODES) return;
    if (Array.isArray(value)) {
      for (const item of value) this.walk(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    this.walkObject(value);
    for (const child of Object.values(value)) {
      if (typeof child === 'object' && child !== null) this.walk(child, depth + 1);
    }
  }

  private walkObject(obj: Record<string, unknown>): void {
    let mimeHint: string | null = null;
    for (const field of MIME_FIELDS) {
      mimeHint = normaliseMime(obj[field]);
      if (mimeHint !== null) break;
    }
    const candidates: Array<[string, URL]> = [];
    for (const [field, value] of Object.entries(obj)) {
      const url = parseHttpsUrl(value);
      if (url !== null) candidates.push([field, url]);
    }
    if (candidates.length === 0) return;

    const generationId = typeof obj.generation_id === 'string' ? obj.generation_id : null;
    const grouped =
      generationId !== null || typeof obj.id === 'string' || typeof obj.id === 'number';
    const keyFor = (url: URL): string =>
      generationId !== null ? `gen:${generationId}` : `url:${url.origin}${url.pathname}`;

    if (!grouped) {
      // A sibling mime describes the media URL, not e.g. a thumbnail beside it.
      const single = candidates.length === 1;
      for (const [field, url] of candidates) {
        const hint = single || PREFERRED_URL_FIELDS.includes(field) ? mimeHint : null;
        this.add(urlOutcome(url, hint, keyFor(url), null));
      }
      return;
    }
    const rank = (field: string): number => {
      const i = PREFERRED_URL_FIELDS.indexOf(field);
      return i === -1 ? PREFERRED_URL_FIELDS.length : i;
    };
    const ordered = [...candidates].sort((a, b) => rank(a[0]) - rank(b[0]));
    let refusedKey: string | null = null;
    for (const [, url] of ordered) {
      const outcome = urlOutcome(url, mimeHint, keyFor(url), null);
      if (outcome !== null && 'ref' in outcome) {
        this.add(outcome);
        return;
      }
      if (outcome !== null) refusedKey ??= outcome.refused;
    }
    if (refusedKey !== null) this.refusedKeys.add(refusedKey);
  }
}

function handleBlock(block: unknown, out: Collector): void {
  if (!isRecord(block)) return;
  switch (block.type) {
    case 'audio':
      out.add(bytesOutcome(block.data, block.mimeType));
      return;
    case 'resource': {
      const resource = block.resource;
      if (isRecord(resource) && typeof resource.blob === 'string') {
        out.add(bytesOutcome(resource.blob, resource.mimeType));
      }
      return;
    }
    case 'resource_link': {
      const url = parseHttpsUrl(block.uri);
      if (url === null) return;
      const name =
        typeof block.name === 'string' && !isGenericFileName(block.name) ? block.name : null;
      out.add(
        urlOutcome(url, normaliseMime(block.mimeType), `url:${url.origin}${url.pathname}`, name),
      );
      return;
    }
    case 'text': {
      // Only JSON is walked: free prose may be model-shaped and must not trigger playback.
      if (typeof block.text !== 'string') return;
      const trimmed = block.text.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
      try {
        out.walk(JSON.parse(trimmed), 0);
      } catch {
        // Not valid JSON after all; nothing to extract.
      }
      return;
    }
    default:
      return;
  }
}

/** Extract playable audio/video references from an MCP tools/call result; `refused` counts offers rejected by the allow-list. */
export function extractMedia(result: McpRawResult): { refs: MediaRef[]; refused: number } {
  const out = new Collector();
  for (const block of result.content ?? []) handleBlock(block, out);
  if (result.structuredContent !== undefined) out.walk(result.structuredContent, 0);
  return { refs: out.refs, refused: out.refused };
}
