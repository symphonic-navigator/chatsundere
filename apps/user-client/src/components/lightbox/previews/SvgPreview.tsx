// SPDX-License-Identifier: AGPL-3.0-only

/** UTF-8-safe base64 (btoa alone mangles multi-byte characters). */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Renders an SVG file as a centred image via a data: URI. Rendering an SVG in
 *  an <img> does not execute any scripts it may contain — safe by construction. */
export function SvgPreview({ content }: { content: string }): JSX.Element {
  const src = `data:image/svg+xml;base64,${utf8ToBase64(content)}`;
  return (
    <div className="lightbox-svg">
      <img src={src} alt="SVG preview" />
    </div>
  );
}
