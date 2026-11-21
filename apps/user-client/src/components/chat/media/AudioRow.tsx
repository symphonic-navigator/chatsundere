// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties, ReactNode } from 'react';
import { formatTime } from './format-time.js';
import { mediaCopy } from './media-copy.js';
import { type MediaElementControls, useMediaElement } from './use-media-element.js';

/** The full-width seek bar shared by the audio row and the video transport. */
export function SeekBar({
  title,
  controls,
}: {
  title: string;
  controls: MediaElementControls;
}): JSX.Element {
  const duration = controls.durationMs ?? 0;
  const current = Math.min(controls.currentMs, duration);
  const percent = duration > 0 ? (current / duration) * 100 : 0;
  return (
    <input
      type="range"
      className="media-seek"
      min={0}
      max={duration}
      step={100}
      value={current}
      disabled={!controls.ready || duration === 0}
      aria-label={mediaCopy.seek(title)}
      aria-valuetext={mediaCopy.position(formatTime(current), formatTime(duration))}
      style={{ '--media-progress': `${percent}%` } as CSSProperties}
      onPointerDown={() => controls.beginScrub()}
      onChange={(e) => controls.seek(Number(e.currentTarget.value))}
    />
  );
}

/** The round play/pause button; greyed out (still focusable) with the reason while unplayable. */
export function PlayButton({
  title,
  controls,
  unavailable,
  className = 'media-play',
}: {
  title: string;
  controls: MediaElementControls;
  unavailable: string | null;
  className?: string;
}): JSX.Element {
  const disabled = unavailable !== null || !controls.ready;
  return (
    <button
      type="button"
      className={className}
      data-playing={controls.playing || undefined}
      aria-label={controls.playing ? mediaCopy.pause(title) : mediaCopy.play(title)}
      aria-disabled={disabled ? 'true' : undefined}
      title={unavailable ?? undefined}
      onClick={() => {
        if (!disabled) controls.toggle();
      }}
    >
      <span className="media-play-glyph" aria-hidden>
        {controls.playing ? '❚❚' : '▶'}
      </span>
    </button>
  );
}

/**
 * One audio file in two lines: play, title, time and "⋯" on the first; a thumb-sized seek
 * bar on the second. The duration comes from the saved metadata, so it shows before play.
 */
export function AudioRow({
  artefactId,
  title,
  blob,
  knownDurationMs,
  unavailable,
  menu,
  note,
}: {
  artefactId: string;
  title: string;
  blob: Blob | null;
  knownDurationMs: number | null;
  /** Why the file cannot play here, or null when it can. */
  unavailable: string | null;
  menu: ReactNode;
  note?: ReactNode;
}): JSX.Element {
  const controls = useMediaElement(artefactId, blob, knownDurationMs);
  const total = controls.durationMs !== null ? formatTime(controls.durationMs) : '–:––';
  return (
    <div className="media-audio" data-unavailable={unavailable !== null || undefined}>
      <div className="media-audio-line">
        <PlayButton title={title} controls={controls} unavailable={unavailable} />
        <span className="media-title">{title}</span>
        <span className="media-time">{`${formatTime(controls.currentMs)} / ${total}`}</span>
        {menu}
      </div>
      <SeekBar title={title} controls={controls} />
      {note}
      <audio {...controls.elementProps} hidden />
    </div>
  );
}
