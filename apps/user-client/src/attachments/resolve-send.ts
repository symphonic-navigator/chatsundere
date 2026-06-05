// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentRow } from '../boot/client-data-db.js';
import type { Disposition } from './vision-gate.js';
import type { ResolvedPart } from './wire-injection.js';

export interface ResolveDeps {
  toDataUrl: (blob: Blob) => Promise<string>;
  describe: (dataUrl: string, model: string) => Promise<string>;
  cacheDescription: (attachmentId: string, model: string, text: string) => Promise<void>;
}

/** Turn a message's attachments into resolved wire parts, running/caching substitute-vision as needed. */
export async function resolveAttachmentParts(
  attachments: AttachmentRow[],
  disposition: Disposition,
  substituteModel: string | null,
  deps: ResolveDeps,
): Promise<ResolvedPart[]> {
  const parts: ResolvedPart[] = [];
  for (const a of attachments) {
    if (a.state === 'deleted') continue;
    if (a.kind === 'text') {
      parts.push({ kind: 'text', fileName: a.fileName, text: a.text ?? '' });
      continue;
    }
    // Corrupt or blob-less image row (blob was never stored or was cleared) — skip silently.
    if (!a.blob) continue;
    if (disposition === 'direct') {
      parts.push({
        kind: 'image-direct',
        fileName: a.fileName,
        dataUrl: await deps.toDataUrl(a.blob),
      });
    } else if (disposition === 'substitute' && substituteModel) {
      let description =
        a.visionDescription?.model === substituteModel ? a.visionDescription.text : null;
      if (description === null) {
        try {
          description = await deps.describe(await deps.toDataUrl(a.blob), substituteModel);
          await deps.cacheDescription(a.id, substituteModel, description);
        } catch {
          // Substitute model unavailable — degrade this image to a placeholder rather than
          // letting the error abort the entire attachment list.
          parts.push({ kind: 'image-placeholder', fileName: a.fileName });
          continue;
        }
      }
      parts.push({
        kind: 'image-description',
        fileName: a.fileName,
        model: substituteModel,
        description,
      });
    } else {
      parts.push({ kind: 'image-placeholder', fileName: a.fileName });
    }
  }
  return parts;
}
