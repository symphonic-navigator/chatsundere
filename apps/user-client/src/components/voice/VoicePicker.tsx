// SPDX-License-Identifier: AGPL-3.0-only

import type { TtsVoice } from '@chatsundere/llm-unified';
import { useEffect, useRef, useState } from 'react';
import { loadVoiceList } from '../../lib/voice/voice-list-active.js';
import { Badge } from '../ui/Badge.js';
import {
  DEFAULT_VOICE_FILTERS,
  VoiceFilterBar,
  type VoiceFilters,
  filterVoices,
  hasVoiceMetadata,
} from './VoiceFilterBar.js';

interface LoadedVoices {
  voices: TtsVoice[];
  /** Voices removed by the juvenile-voice rule (ADR 0040). */
  hiddenCount: number;
  /** The service the voices come from; null without a transport. */
  providerName: string | null;
}

/** Load the active offering's voices through the shared memo (empty without a transport). */
async function fetchVoices(fresh = false): Promise<LoadedVoices> {
  const loaded = await loadVoiceList({ fresh });
  if (!loaded) return { voices: [], hiddenCount: 0, providerName: null };
  return {
    voices: loaded.list.voices,
    hiddenCount: loaded.list.hiddenCount,
    providerName: loaded.providerDisplayName,
  };
}

type VoiceLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | ({ status: 'loaded' } & LoadedVoices)
  | { status: 'error' };

const GENDER_GLYPH = { female: '♀', male: '♂' } as const;

interface Props {
  /** Currently selected voice id, or null for no voice. */
  value: string | null;
  /** Called when the user picks a voice id (or null for "None"). */
  onSelect: (id: string | null) => void;
  /** Label shown above the picker button. */
  label: string;
  /** Disables the control entirely. */
  disabled?: boolean;
  /** Hint text shown when the control is disabled. */
  disabledHint?: string;
}

/**
 * A reusable voice picker for a single TTS voice slot (persona voice or narrator voice).
 * Voices resolve eagerly for a selected value and refresh on every open. When no TTS provider is configured the control
 * renders disabled with a constructive hint.
 */
export function VoicePicker({
  value,
  onSelect,
  label,
  disabled,
  disabledHint,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<VoiceLoadState>({ status: 'idle' });
  const [filters, setFilters] = useState<VoiceFilters>(DEFAULT_VOICE_FILTERS);
  // Request sequence: every fetch caller takes a number and applies its result
  // only while it is still the latest, so a slow earlier request can never
  // overwrite (or error over) a fresher list.
  const seq = useRef(0);

  // Resolve the selected voice's display NAME without requiring the user to open
  // the picker. Opening refetches the list anyway, but the collapsed trigger needs
  // the name now — otherwise it shows the raw voice id (device finding 2026-06-12).
  // The fetch is session-memoised (one network call shared across pickers), so
  // eager resolution is cheap; it runs only when a voice is selected, the control
  // is enabled, and nothing has been loaded yet.
  useEffect(() => {
    if (disabled || value === null) return;
    let cancelled = false;
    const mine = ++seq.current;
    // Functional update (not a `loadState` dep) so the effect runs only when the
    // value/disabled inputs change — adding `status` would re-run the effect on
    // the idle→loading flip and its cleanup would cancel its own in-flight fetch.
    setLoadState((prev) => (prev.status === 'loaded' ? prev : { status: 'loading' }));
    fetchVoices().then(
      (loaded) => {
        if (!cancelled && seq.current === mine) setLoadState({ status: 'loaded', ...loaded });
      },
      () => {
        if (!cancelled && seq.current === mine) setLoadState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [disabled, value]);

  function handleOpen(): void {
    if (disabled) return;
    setOpen(true);
    // Every open starts from an empty search on All / Any (spec §7.1).
    setFilters(DEFAULT_VOICE_FILTERS);
    // Opening refreshes the list (a newly added voice must appear); an already
    // loaded list stays visible meanwhile instead of flashing back to loading.
    if (loadState.status !== 'loaded') setLoadState({ status: 'loading' });
    const mine = ++seq.current;
    fetchVoices(true).then(
      (loaded) => {
        if (seq.current === mine) setLoadState({ status: 'loaded', ...loaded });
      },
      () => {
        if (seq.current === mine) {
          setLoadState((prev) => (prev.status === 'loaded' ? prev : { status: 'error' }));
        }
      },
    );
  }

  function handleRetry(): void {
    setLoadState({ status: 'loading' });
    const mine = ++seq.current;
    fetchVoices(true).then(
      (loaded) => {
        if (seq.current === mine) setLoadState({ status: 'loaded', ...loaded });
      },
      () => {
        if (seq.current === mine) setLoadState({ status: 'error' });
      },
    );
  }

  function handleSelect(id: string | null): void {
    onSelect(id);
    setOpen(false);
  }

  const loaded = loadState.status === 'loaded' ? loadState : null;
  const selectedVoice = loaded?.voices.find((v) => v.id === value) ?? null;
  // A stored voice missing from a list that DID load is stale: say so and ask for
  // a new pick (spec §7.2). Only a loaded list can prove absence; after a load
  // error the raw id stays as the honest last resort.
  const stale = loaded !== null && value !== null && selectedVoice === null;
  const resolving =
    value !== null && (loadState.status === 'idle' || loadState.status === 'loading');
  const displayValue = selectedVoice?.name ?? (resolving ? '…' : (value ?? null));
  const visibleVoices = loaded ? filterVoices(loaded.voices, filters) : [];
  const showFilters = loaded !== null && hasVoiceMetadata(loaded.voices);

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase tracking-widest text-paper-soft">{label}</div>

      {disabled ? (
        <div className="rounded-md border border-white/5 bg-white/[0.02] p-3 text-sm text-paper-soft">
          {disabledHint ?? 'Unavailable'}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={handleOpen}
            aria-label={`Pick ${label}`}
            className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-paper hover:border-paper-soft"
          >
            {stale ? (
              <span className="text-left text-paper-soft">
                This voice isn&apos;t available
                {loaded?.providerName ? (
                  <>
                    {' '}
                    at <strong className="text-paper">{loaded.providerName}</strong>
                  </>
                ) : null}{' '}
                — choose a new one.
              </span>
            ) : (
              <span className={displayValue ? 'text-paper' : 'text-paper-soft'}>
                {displayValue ?? 'None — pick a voice'}
              </span>
            )}
            <span className="text-paper-soft">▾</span>
          </button>

          {open ? (
            <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-white/10 bg-surface-raised">
              {loadState.status === 'loading' ? (
                <p className="px-3 py-2 text-sm text-paper-soft">Loading voices…</p>
              ) : loadState.status === 'error' ? (
                <div className="px-3 py-2">
                  <p className="mb-1 text-sm text-paper-soft">
                    Couldn&apos;t load the voice list — check your connection and your voice
                    provider&apos;s account.
                  </p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="text-xs uppercase tracking-wider text-paper hover:text-paper-soft"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {showFilters ? <VoiceFilterBar filters={filters} onChange={setFilters} /> : null}
                  {/* None row */}
                  <button
                    type="button"
                    aria-pressed={value === null}
                    onClick={() => handleSelect(null)}
                    className={`w-full px-3 py-2 text-left text-sm ${
                      value === null
                        ? 'bg-white/5 text-paper'
                        : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
                    }`}
                  >
                    None
                  </button>

                  {loaded ? (
                    <VoiceRows
                      loaded={loaded}
                      voices={visibleVoices}
                      onClearFilters={() => setFilters(DEFAULT_VOICE_FILTERS)}
                      value={value}
                      onSelect={handleSelect}
                    />
                  ) : null}
                </>
              )}

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border-t border-white/5 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:text-paper"
              >
                Close
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function VoiceRows({
  loaded,
  voices,
  value,
  onSelect,
  onClearFilters,
}: {
  loaded: LoadedVoices;
  voices: TtsVoice[];
  value: string | null;
  onSelect: (id: string) => void;
  onClearFilters: () => void;
}): JSX.Element {
  const { hiddenCount, providerName } = loaded;
  return (
    <>
      {loaded.voices.length === 0 ? (
        <p className="px-3 py-2 text-sm text-paper-soft">
          {providerName
            ? `No voices on your ${providerName} account yet — add them on the ${providerName} website.`
            : 'No voices available yet.'}
        </p>
      ) : voices.length === 0 ? (
        <div className="px-3 py-2">
          <p className="mb-1 text-sm text-paper-soft">No voice matches</p>
          <button
            type="button"
            onClick={onClearFilters}
            className="text-xs uppercase tracking-wider text-paper hover:text-paper-soft"
          >
            Clear search and filters
          </button>
        </div>
      ) : (
        <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
          {voices.map((voice) => (
            <button
              key={voice.id}
              type="button"
              aria-pressed={voice.id === value}
              onClick={() => onSelect(voice.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                voice.id === value
                  ? 'bg-white/5 text-paper'
                  : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{voice.name}</span>
              {voice.origin === 'own' ? <Badge>own</Badge> : null}
              {voice.language ? <Badge>{voice.language}</Badge> : null}
              {voice.gender === 'female' || voice.gender === 'male' ? (
                <span title={voice.gender === 'female' ? 'Female' : 'Male'}>
                  <span aria-hidden="true">{GENDER_GLYPH[voice.gender]}</span>
                  <span className="sr-only">{voice.gender}</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {hiddenCount > 0 ? (
        <p className="border-t border-white/5 px-3 py-2 text-[11px] text-paper-soft">
          {hiddenCount === 1 ? '1 voice' : `${hiddenCount} voices`} hidden by our juvenile-voice
          rule
        </p>
      ) : null}
    </>
  );
}
