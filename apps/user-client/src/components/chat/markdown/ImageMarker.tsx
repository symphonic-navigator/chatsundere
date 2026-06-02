// SPDX-License-Identifier: AGPL-3.0-only
import { type ComponentPropsWithoutRef, useState } from 'react';

/** Classify an image source for display + safety.
 *
 *  Only `http(s)` and `data:image/…` are `loadable`; everything else
 *  (`javascript:`, `file:`, `blob:`, non-image `data:`, relative, empty) is
 *  rejected so it is never fetched and — crucially — never becomes a clickable
 *  `href`. This is the scheme allowlist that backs the defence-in-depth against
 *  a `javascript:` URL slipping past react-markdown's `urlTransform`.
 *
 *  Remote http(s) sources carry their hostname (shown before any load); a
 *  data-image is loadable but hostless ("embedded"). */
function describeSource(src: string): {
  loadable: boolean;
  embedded: boolean;
  host: string | null;
} {
  if (src.startsWith('data:image/')) return { loadable: true, embedded: true, host: null };
  try {
    const url = new URL(src);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { loadable: true, embedded: false, host: url.hostname };
    }
  } catch {
    // Not an absolute URL — fall through to the not-loadable result.
  }
  return { loadable: false, embedded: false, host: null };
}

/**
 * Privacy-respecting renderer for Markdown image syntax (`![alt](url)`).
 *
 * Left to react-markdown's default, that syntax becomes a bare `<img>` the
 * browser fetches the instant it renders — leaking the user's IP, User-Agent
 * and timing to whatever third party the model named. That is the classic
 * Markdown-image tracking-pixel / exfiltration vector against chat UIs, and it
 * contradicts our zero-knowledge promise (the server sees nothing, but the
 * client would beacon out on model instruction).
 *
 * Instead we render a tap-to-load pill that names the source domain up front.
 * The network request only happens on explicit user consent, with
 * `referrer-policy: no-referrer`, and the decision is never persisted — a
 * re-mount shows the pill again rather than silently re-fetching.
 *
 * Unsafe / unusable schemes (`javascript:`, `file:`, relative, …) never become
 * a loadable pill or a clickable link — they fall back to an inert marker. The
 * "open in new tab" recovery link is only offered for http(s) sources.
 *
 * Follow-up (Phase 2): route "tap to load" through proxy-service so even a
 * consented load doesn't expose the user's IP.
 */
export function ImageMarker({ src, alt, title }: ComponentPropsWithoutRef<'img'>): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const source = typeof src === 'string' ? src : '';
  const { loadable, embedded, host } = describeSource(source);
  const label = alt?.trim() ? alt.trim() : embedded ? 'embedded image' : 'image';

  if (!loadable) {
    // No usable / safe source — surface the alt text as an inert marker. Never
    // fetched, never a clickable href.
    return (
      <span className="image-marker" data-empty="true">
        🖼 {label}
      </span>
    );
  }

  if (loaded && !errored) {
    return (
      <img
        className="image-marker-img"
        src={source}
        alt={alt ?? ''}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
      />
    );
  }

  if (errored) {
    // Constructive failure (the dere half): name what went wrong and offer the
    // next step rather than leaving a broken-image glyph. The link is only
    // shown for http(s) sources (host present) — a data-image has nowhere
    // useful to open, and unsafe schemes never reach here.
    return (
      <span className="image-marker image-marker--error">
        🖼 Couldn't load image
        {host ? (
          <>
            {' '}
            from <code>{host}</code> —{' '}
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              open in new tab
            </a>
          </>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="image-marker"
      title={embedded ? 'Show embedded image' : `Load image from ${host ?? source}`}
      onClick={(e) => {
        // Don't let the tap bubble up to the message bubble's expand toggle.
        e.stopPropagation();
        setLoaded(true);
      }}
    >
      🖼 <span className="image-marker-label">{label}</span>
      {host ? <span className="image-marker-host">· {host}</span> : null}
      <span className="image-marker-cta">— {embedded ? 'tap to show' : 'tap to load'}</span>
    </button>
  );
}
