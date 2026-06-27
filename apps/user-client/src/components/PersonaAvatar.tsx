// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { usePersonaAvatar } from '../data/persona-avatars.js';
import { cropToBackground } from '../lib/avatar-crop.js';
import { monogramFor } from '../lib/monogram.js';

/**
 * Rounded-square persona avatar. Renders the stored image (CSS-cropped) when
 * present, otherwise the monogram tile — identical look to the legacy tile so
 * personas without an image are unchanged.
 */
export function PersonaAvatar({
  personaId,
  name,
  colour,
  size,
}: {
  personaId: string;
  name: string;
  colour: string;
  size: number;
}): JSX.Element {
  const { data } = usePersonaAvatar(personaId);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(data.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data?.blob]);

  if (url && data) {
    const bg = cropToBackground(data.width, data.height, data.crop, size);
    return (
      <div
        data-persona-avatar
        role="img"
        aria-label={`${name} avatar`}
        className="shrink-0 overflow-hidden rounded-md bg-cover bg-center"
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${url})`,
          backgroundSize: bg.backgroundSize,
          backgroundPosition: bg.backgroundPosition,
          backgroundRepeat: 'no-repeat',
        }}
      />
    );
  }

  return (
    <div
      data-persona-avatar
      role="img"
      aria-label={`${name} avatar`}
      className="grid shrink-0 place-items-center rounded-md font-display"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `${colour}1f`,
        color: colour,
        border: `1px solid ${colour}33`,
      }}
    >
      {monogramFor(name)}
    </div>
  );
}
