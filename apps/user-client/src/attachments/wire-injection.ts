// SPDX-License-Identifier: AGPL-3.0-only
import type { WireContentPart } from '@chatsundere/llm-unified';

/** A fully-resolved attachment part, ready to be wired into a user turn. */
export type ResolvedPart =
  | { kind: 'image-direct'; fileName: string; dataUrl: string }
  | { kind: 'image-description'; fileName: string; model: string; description: string }
  | { kind: 'image-placeholder'; fileName: string }
  | { kind: 'text'; fileName: string; text: string };

/**
 * Build the wire `content` for a user turn from its text plus already-resolved attachment
 * parts. Returns a plain string when there are no attachments (unchanged behaviour), else the
 * multimodal array. The filename always travels on every attachment kind.
 */
export function buildUserWireContent(
  text: string,
  parts: ResolvedPart[],
): string | WireContentPart[] {
  if (parts.length === 0) return text;

  const out: WireContentPart[] = [];

  if (text.length > 0) out.push({ type: 'text', text });

  for (const p of parts) {
    switch (p.kind) {
      case 'image-direct':
        out.push({ type: 'text', text: `[Image: ${p.fileName}]` });
        out.push({ type: 'image_url', image_url: { url: p.dataUrl } });
        break;
      case 'image-description':
        out.push({
          type: 'text',
          text: `[Image description for ${p.fileName} (via ${p.model}):\n${p.description}\n]`,
        });
        break;
      case 'image-placeholder':
        out.push({
          type: 'text',
          text: `[Image: ${p.fileName} — current model cannot see images, image omitted]`,
        });
        break;
      case 'text':
        out.push({ type: 'text', text: `Attachment: ${p.fileName}\n\`\`\`\n${p.text}\n\`\`\`` });
        break;
    }
  }

  return out;
}
