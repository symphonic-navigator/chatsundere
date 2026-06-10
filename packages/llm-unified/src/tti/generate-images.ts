// SPDX-License-Identifier: LGPL-3.0-only
import { buildRequest } from '../transport.js';
import type { ProviderConfig } from '../types.js';
import type { ImageModelConfig } from './config.js';
import { parseImagesResponse } from './parse.js';
import { buildImagePayload } from './payloads.js';

/** xAI returns within ~tens of seconds; Z-Image base at count 4 takes ~3 min.
 *  GPT Image 2 at quality high took ~3.5 min for a single 1K image. */
const POST_TIMEOUT_MS: Record<ImageModelConfig['groupId'], number> = {
  'xai-imagine': 60_000,
  zimage: 300_000,
  seedream: 300_000,
  'gpt-image-2': 600_000,
};
const URL_FETCH_TIMEOUT_MS = 60_000;

/** Connection-independent inputs the caller (apps/) resolves per provider row. */
export interface ImageRequestBase {
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
}

export interface GenerateImagesArgs extends ImageRequestBase {
  config: ImageModelConfig;
  prompt: string;
  /** Already clamped by the caller via `maxCountFor`. */
  count: number;
  signal?: AbortSignal;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export type ImageGenItem =
  | { kind: 'image'; bytes: Blob; mime: string }
  | { kind: 'moderated'; reason: string | null };

export interface GenerateImagesResult {
  items: ImageGenItem[];
  /** The upstream model id actually used (e.g. 'grok-imagine-image-quality'). */
  modelId: string;
}

/** Typed failure for the whole generation call (HTTP error, malformed body). */
export class ImageGenerationError extends Error {
  status?: number;
  providerMessage?: string;
  constructor(message: string, opts?: { status?: number; providerMessage?: string }) {
    super(message);
    this.name = 'ImageGenerationError';
    this.status = opts?.status;
    this.providerMessage = opts?.providerMessage;
  }
}

function extractProviderMessage(json: unknown): string | undefined {
  const err = (json as { error?: { message?: unknown } })?.error;
  return typeof err?.message === 'string' ? err.message : undefined;
}

function b64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * One-shot image generation over the provider's
 * `/images/generations` endpoint (OpenAI-compatible). Routing (direct or
 * cors-proxy) follows the provider row, like every other call. Result URLs
 * (nano-gpt R2) are fetched with a bare GET and NO Authorization header — a
 * Bearer token collides with the AWS-V4 signature (spec §5.2). A failed
 * per-URL fetch degrades that item to `moderated`, never the whole call.
 */
export async function generateImages(args: GenerateImagesArgs): Promise<GenerateImagesResult> {
  const fetchFn = args.fetchFn ?? fetch;
  const body = buildImagePayload(args.config, args.prompt, args.count);
  const modelId = String(body.model);

  const timeoutSignal = AbortSignal.timeout(POST_TIMEOUT_MS[args.config.groupId]);
  const signal = args.signal ? AbortSignal.any([args.signal, timeoutSignal]) : timeoutSignal;

  const request = buildRequest({
    provider: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    path: '/images/generations',
    method: 'POST',
    body,
  });
  const response = await fetchFn(request, { signal });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    throw new ImageGenerationError(`image generation returned ${response.status}`, {
      status: response.status,
      providerMessage: extractProviderMessage(json),
    });
  }

  const raw = parseImagesResponse(args.config.groupId, json);
  if (raw.length === 0) {
    throw new ImageGenerationError('image generation returned no items', {
      status: response.status,
      providerMessage: extractProviderMessage(json),
    });
  }

  const items: ImageGenItem[] = [];
  for (const item of raw) {
    if (item.kind === 'moderated') {
      items.push(item);
      continue;
    }
    if (item.kind === 'b64') {
      const mime = item.mime ?? 'image/jpeg';
      items.push({ kind: 'image', bytes: b64ToBlob(item.b64, mime), mime });
      continue;
    }
    try {
      const urlSignal = args.signal
        ? AbortSignal.any([args.signal, AbortSignal.timeout(URL_FETCH_TIMEOUT_MS)])
        : AbortSignal.timeout(URL_FETCH_TIMEOUT_MS);
      // Bare GET, deliberately header-free (R2 signed URL — Bearer token clashes with AWS-V4 sig).
      const blobResponse = await fetchFn(item.url, { signal: urlSignal });
      if (!blobResponse.ok) {
        items.push({ kind: 'moderated', reason: `image fetch returned ${blobResponse.status}` });
        continue;
      }
      const bytes = await blobResponse.blob();
      const mime = blobResponse.headers.get('content-type') ?? 'image/jpeg';
      items.push({ kind: 'image', bytes, mime });
    } catch {
      // Deliberate: any per-URL failure (including a caller abort mid-loop)
      // degrades only this item — partial results beat a wholesale failure.
      items.push({ kind: 'moderated', reason: 'image fetch failed' });
    }
  }
  return { items, modelId };
}
