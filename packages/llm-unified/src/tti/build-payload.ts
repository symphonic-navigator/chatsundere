// SPDX-License-Identifier: LGPL-3.0-only
import type { ImageModelConfig, TtiDescriptor } from './descriptor.js';

/**
 * Build the OpenAI-shaped `/images/generations` body for one offering. The
 * descriptor's `wire` decides the shape; nothing here knows about specific
 * models. `response_format` follows the provider: nano-gpt's R2 bucket is
 * fetched by URL, xAI's CDN is closed to browsers so it returns base64.
 */
export function buildImagePayload(
  slug: string,
  meta: TtiDescriptor,
  config: ImageModelConfig,
  prompt: string,
  n: number,
): Record<string, unknown> {
  const wire = meta.wire;
  const swapped =
    wire.kind === 'aspect-resolution' && config.quality !== null
      ? wire.modelByQuality?.[config.quality]
      : undefined;
  const body: Record<string, unknown> = {
    model: swapped ?? slug,
    prompt,
    n,
    response_format: wire.responseFormat,
  };

  if (wire.kind === 'aspect-resolution') {
    body.aspect_ratio = config.aspect;
    if (wire.sendResolution && config.resolution !== null) body.resolution = config.resolution;
    if (wire.qualityParam && config.quality !== null) body[wire.qualityParam] = config.quality;
    if (wire.extra) Object.assign(body, wire.extra);
    return body;
  }

  const key = `${config.aspect}|${config.resolution ?? '-'}`;
  const size = wire.sizes[key];
  if (!size) throw new Error(`${slug}: no size for ${config.aspect} x ${config.resolution ?? '-'}`);
  body.size = `${size[0]}x${size[1]}`;
  if (wire.qualityParam && config.quality !== null) body[wire.qualityParam] = config.quality;
  return body;
}
