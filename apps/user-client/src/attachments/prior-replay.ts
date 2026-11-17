// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../boot/client-data-db.js';
import { IMAGE_TOKEN_ESTIMATE, estimateTokens } from '../lib/token-estimator.js';
import { type ResolvedPart, renderTextAttachment } from './wire-injection.js';

/** How many of the most recent image-bearing user turns keep their images in the LLM context. */
export const PRIOR_IMAGE_TURN_WINDOW = 3;

export { IMAGE_TOKEN_ESTIMATE };

/** Upper-bound tokens a user turn's attachments cost on the wire. */
export function estimateAttachmentTokens(attachments: readonly AttachmentRow[]): number {
  let total = 0;
  for (const a of attachments) {
    if (a.state === 'deleted') continue;
    total +=
      a.kind === 'image'
        ? IMAGE_TOKEN_ESTIMATE
        : estimateTokens(renderTextAttachment(a.fileName, a.text ?? ''));
  }
  return total;
}

/** Pick the last `PRIOR_IMAGE_TURN_WINDOW` message ids (given chronologically) that carry a live image. */
export function imageWindowMessageIds(
  userMessageIds: readonly string[],
  attachmentsByMessage: ReadonlyMap<string, readonly AttachmentRow[]>,
): Set<string> {
  const withImage = userMessageIds.filter((id) =>
    (attachmentsByMessage.get(id) ?? []).some((a) => a.kind === 'image' && a.state !== 'deleted'),
  );
  return new Set(withImage.slice(-PRIOR_IMAGE_TURN_WINDOW));
}

/** Resolve an out-of-window turn's attachments without I/O: text in full, images as cached description or marker. */
export function resolveEarlierParts(attachments: readonly AttachmentRow[]): ResolvedPart[] {
  const parts: ResolvedPart[] = [];
  for (const a of attachments) {
    if (a.state === 'deleted') continue;
    if (a.kind === 'text') {
      parts.push({ kind: 'text', fileName: a.fileName, text: a.text ?? '' });
    } else if (a.visionDescription) {
      parts.push({
        kind: 'image-description',
        fileName: a.fileName,
        model: a.visionDescription.model,
        description: a.visionDescription.text,
      });
    } else {
      parts.push({ kind: 'image-earlier', fileName: a.fileName });
    }
  }
  return parts;
}
