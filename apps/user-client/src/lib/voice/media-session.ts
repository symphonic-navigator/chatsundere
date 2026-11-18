// SPDX-License-Identifier: AGPL-3.0-only
/**
 * UI-free helpers over `navigator.mediaSession` for read-aloud's lock-screen and
 * headset controls. Every call is feature-detected and wrapped: a browser
 * without the API, or one that throws on an action it does not know
 * (`setActionHandler` does in some), behaves exactly as without controls.
 */
import type { AvatarCrop } from '../../boot/client-data-db.js';
import { cropToRect } from '../avatar-crop.js';

/** The actions read-aloud offers on the lock screen and headset. */
export type ReadAloudAction = 'play' | 'pause' | 'nexttrack' | 'stop';

const OFFERED: readonly ReadAloudAction[] = ['play', 'pause', 'nexttrack', 'stop'];
// Set to null so platforms hide them: the voice machine has no backwards step
// and no seek.
const HIDDEN: readonly MediaSessionAction[] = [
  'previoustrack',
  'seekforward',
  'seekbackward',
  'seekto',
];

/** The app icon, shown when a persona has no avatar or is an adult persona. */
export const APP_ICON_ARTWORK = '/icons/icon-512.png';

/** Square size of the rendered avatar artwork, in px. */
export const ARTWORK_SIZE = 256;

export interface ReadAloudMetadata {
  title: string;
  artist?: string;
  artwork: { src: string; sizes: string; type: string };
}

function session(): MediaSession | null {
  try {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
    return navigator.mediaSession ?? null;
  } catch {
    return null;
  }
}

function setHandler(s: MediaSession, action: MediaSessionAction, handler: (() => void) | null) {
  try {
    s.setActionHandler(action, handler);
  } catch {
    // Unknown action in this browser: there is nothing to show or hide.
  }
}

/** Whether this browser has a Media Session to talk to. */
export function hasMediaSession(): boolean {
  return session() !== null;
}

/**
 * What the lock screen shows for a persona. An adult persona shows only the app
 * (Q3: anyone near the phone sees the lock screen); other personas their name
 * and avatar. Message text never appears here, by construction: it is not an input.
 */
export function readAloudMetadata(
  persona: { name: string; adultPersona: boolean },
  avatarArtwork: string | null,
): ReadAloudMetadata {
  const icon = { src: APP_ICON_ARTWORK, sizes: '512x512', type: 'image/png' };
  if (persona.adultPersona) return { title: 'Chatsundere', artwork: icon };
  return {
    title: persona.name,
    artist: 'Chatsundere',
    artwork: avatarArtwork
      ? { src: avatarArtwork, sizes: `${ARTWORK_SIZE}x${ARTWORK_SIZE}`, type: 'image/png' }
      : icon,
  };
}

/** Show read-aloud's metadata on the platform's media surfaces. */
export function setReadAloudMetadata(meta: ReadAloudMetadata): void {
  const s = session();
  if (!s || typeof MediaMetadata === 'undefined') return;
  try {
    s.metadata = new MediaMetadata({
      title: meta.title,
      ...(meta.artist ? { artist: meta.artist } : {}),
      artwork: [meta.artwork],
    });
  } catch {
    // A rejected artwork or metadata shape leaves the platform's default.
  }
}

/** Register read-aloud's handlers and hide the actions it has no meaning for. */
export function setReadAloudHandlers(handlers: Record<ReadAloudAction, () => void>): void {
  const s = session();
  if (!s) return;
  for (const action of OFFERED) setHandler(s, action, handlers[action]);
  for (const action of HIDDEN) setHandler(s, action, null);
}

/** Mirror read-aloud's play state onto the platform's controls. */
export function setReadAloudPlaybackState(state: MediaSessionPlaybackState): void {
  const s = session();
  if (!s) return;
  try {
    s.playbackState = state;
  } catch {
    // Older implementations lack playbackState: the element's own state stands in.
  }
}

/** Clear everything read-aloud set, so no stale entry outlives the read or the chat. */
export function clearReadAloudSession(): void {
  const s = session();
  if (!s) return;
  try {
    s.metadata = null;
  } catch {
    // Nothing to clear.
  }
  for (const action of [...OFFERED, ...HIDDEN]) setHandler(s, action, null);
  setReadAloudPlaybackState('none');
}

async function loadImage(blob: Blob): Promise<CanvasImageSource & { close?: () => void }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Render an avatar with its stored crop to a square PNG for lock-screen artwork.
 * Returns a `blob:` URL the caller revokes, or null when the platform cannot
 * render (the app icon then stands in).
 */
export async function renderAvatarArtwork(avatar: {
  blob: Blob;
  width: number;
  height: number;
  crop: AvatarCrop;
}): Promise<string | null> {
  try {
    const image = await loadImage(avatar.blob);
    const canvas = document.createElement('canvas');
    canvas.width = ARTWORK_SIZE;
    canvas.height = ARTWORK_SIZE;
    const g = canvas.getContext('2d');
    if (!g) {
      image.close?.();
      return null;
    }
    const rect = cropToRect(avatar.width, avatar.height, avatar.crop, ARTWORK_SIZE);
    g.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    image.close?.();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ? URL.createObjectURL(png) : null;
  } catch {
    return null;
  }
}
