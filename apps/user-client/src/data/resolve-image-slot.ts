// SPDX-License-Identifier: AGPL-3.0-only
import {
  type ImageSlot,
  type TtiDescriptor,
  getOffering,
  getTtiDescriptor,
  upgradeImageSlot,
} from '@chatsundere/llm-unified';
import type { ImageGenerationSlot } from '../tools/generate-image.js';

/** A stored slot resolved against the offering catalogue, minus provider credentials. */
export interface BuiltImageSlot {
  slot: ImageGenerationSlot;
  templateId: string;
  slug: string;
  meta: TtiDescriptor;
}

/**
 * Pure part of image-slot resolution: upgrade a stored slot of any vintage and
 * read everything else (label, NSFW capability, per-call cap) from its descriptor.
 * Null for junk or a retired offering.
 */
export function buildImageSlot(stored: unknown): BuiltImageSlot | null {
  const upgraded: ImageSlot | null = upgradeImageSlot(stored, getTtiDescriptor);
  if (!upgraded) return null;
  const idx = upgraded.ref.indexOf(':');
  if (idx < 0) return null;
  const templateId = upgraded.ref.slice(0, idx);
  const slug = upgraded.ref.slice(idx + 1);
  const meta = getOffering(templateId, slug)?.tti;
  if (!meta) return null;
  return {
    slot: {
      ref: upgraded.ref,
      modelLabel: meta.displayName,
      canDoNsfw: meta.canDoNsfw,
      config: upgraded.config,
      maxCount: meta.maxCount,
    },
    templateId,
    slug,
    meta,
  };
}
