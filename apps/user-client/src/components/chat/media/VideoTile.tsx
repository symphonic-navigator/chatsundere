// SPDX-License-Identifier: AGPL-3.0-only
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import type { ArtefactRow } from '../../../boot/client-data-db.js';
import { useBlobBytes } from '../../../sync/blob-fetch.js';
import { PlayButton, SeekBar } from './AudioRow.js';
import { formatTime } from './format-time.js';
import { mediaCopy } from './media-copy.js';
import { useMediaElement } from './use-media-element.js';

type FullscreenCapable = HTMLMediaElement & { webkitEnterFullscreen?: () => void };

function enterFullscreen(el: HTMLMediaElement | null): void {
  if (!el) return;
  if (typeof el.requestFullscreen === 'function') {
    void el.requestFullscreen().catch(() => undefined);
    return;
  }
  // iOS Safari has no element fullscreen, only the video's own.
  (el as FullscreenCapable).webkitEnterFullscreen?.();
}

function usePosterUrl(artefact: ArtefactRow): string | null {
  const fetched = useBlobBytes('artefacts', artefact.id, 'thumbBlob');
  const local = artefact.thumbBlob && artefact.thumbBlob.size > 0 ? artefact.thumbBlob : null;
  const poster = local ?? (fetched.state === 'ready' ? (fetched.bytes ?? null) : null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!poster) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(poster);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [poster]);
  return url;
}

/**
 * One video: its poster with the duration bottom-left, a play glyph in the centre and "⋯"
 * top-right. A tap plays it inline (`playsInline`, for iOS) under the same transport as audio,
 * plus fullscreen.
 */
export function VideoTile({
  artefact,
  title,
  blob,
  unavailable,
  menu,
  note,
}: {
  artefact: ArtefactRow;
  title: string;
  blob: Blob | null;
  unavailable: string | null;
  menu: ReactNode;
  note?: ReactNode;
}): JSX.Element {
  const controls = useMediaElement(artefact.id, blob, artefact.mediaMeta?.durationMs ?? null);
  const posterUrl = usePosterUrl(artefact);
  const [started, setStarted] = useState(false);
  const disabled = unavailable !== null || !controls.ready;
  const aspect =
    artefact.width && artefact.height ? `${artefact.width} / ${artefact.height}` : '16 / 9';
  const total = controls.durationMs !== null ? formatTime(controls.durationMs) : '–:––';

  const start = (): void => {
    if (disabled) return;
    setStarted(true);
    controls.play();
  };

  return (
    <div className="media-video-wrap" data-unavailable={unavailable !== null || undefined}>
      <div
        className="media-video"
        data-started={started || undefined}
        style={{ '--media-aspect': aspect } as CSSProperties}
      >
        <video
          {...controls.elementProps}
          className="media-video-el"
          playsInline
          poster={posterUrl ?? undefined}
          onClick={() => {
            if (started && !disabled) controls.toggle();
          }}
        />
        {!started ? (
          <>
            {posterUrl ? (
              <img className="media-video-poster" src={posterUrl} alt={title} />
            ) : (
              <span className="media-video-poster media-video-blank" aria-hidden />
            )}
            <button
              type="button"
              className="media-video-start"
              aria-label={mediaCopy.play(title)}
              aria-disabled={disabled ? 'true' : undefined}
              title={unavailable ?? undefined}
              onClick={start}
            >
              <span className="media-video-glyph" aria-hidden>
                ▶
              </span>
            </button>
            {controls.durationMs !== null ? (
              <span className="media-video-badge">{formatTime(controls.durationMs)}</span>
            ) : null}
          </>
        ) : (
          <div className="media-video-transport">
            <div className="media-audio-line">
              <PlayButton title={title} controls={controls} unavailable={unavailable} />
              <span className="media-time">{`${formatTime(controls.currentMs)} / ${total}`}</span>
              <button
                type="button"
                className="media-fullscreen"
                aria-label={mediaCopy.fullscreen}
                onClick={() => enterFullscreen(controls.element())}
              >
                <span aria-hidden>⛶</span>
              </button>
            </div>
            <SeekBar title={title} controls={controls} />
          </div>
        )}
        {menu ? <div className="media-video-menu">{menu}</div> : null}
      </div>
      <div className="media-video-caption">
        <span className="media-title">{title}</span>
      </div>
      {note}
    </div>
  );
}
