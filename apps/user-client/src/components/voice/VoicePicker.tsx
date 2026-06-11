// SPDX-License-Identifier: AGPL-3.0-only

import { type TtsVoice, listTtsVoices } from '@chatsundere/llm-unified';
import { useState } from 'react';
import { resolveTtsTransport } from '../../lib/voice/resolve-tts.js';

// Module-level memo: one fetch per session, shared across all VoicePicker instances.
let voicesPromise: Promise<TtsVoice[]> | null = null;

/** Reset the cached voices promise. Exposed for tests only. */
export function _resetVoicePickerCacheForTests(): void {
  voicesPromise = null;
}

/**
 * Fetch all available TTS voices, reusing the cached promise on subsequent calls.
 * Clears the cache and retries on failure when `retry` is true.
 */
async function fetchVoices(retry = false): Promise<TtsVoice[]> {
  if (retry) voicesPromise = null;
  if (!voicesPromise) {
    voicesPromise = (async (): Promise<TtsVoice[]> => {
      const transport = await resolveTtsTransport();
      if (!transport) return [];
      return listTtsVoices({
        providerConfig: transport.providerConfig,
        apiKey: transport.apiKey,
        corsProxyUrl: transport.corsProxyUrl,
        corsProxyKey: transport.corsProxyKey,
        signal: AbortSignal.timeout(15_000),
      });
    })();
    // On failure, clear the memo so the next call can retry.
    voicesPromise.catch(() => {
      voicesPromise = null;
    });
  }
  return voicesPromise;
}

type VoiceLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; voices: TtsVoice[] }
  | { status: 'error' };

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
 * Voices load lazily on first open. When no TTS provider is configured the control
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

  function handleOpen(): void {
    if (disabled) return;
    setOpen(true);
    if (loadState.status === 'idle' || loadState.status === 'error') {
      setLoadState({ status: 'loading' });
      fetchVoices().then(
        (voices) => setLoadState({ status: 'loaded', voices }),
        () => setLoadState({ status: 'error' }),
      );
    }
  }

  function handleRetry(): void {
    setLoadState({ status: 'loading' });
    fetchVoices(true).then(
      (voices) => setLoadState({ status: 'loaded', voices }),
      () => setLoadState({ status: 'error' }),
    );
  }

  function handleSelect(id: string | null): void {
    onSelect(id);
    setOpen(false);
  }

  const selectedVoice =
    loadState.status === 'loaded' ? loadState.voices.find((v) => v.id === value) : null;
  const displayValue = selectedVoice?.name ?? value ?? null;

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
            <span className={displayValue ? 'text-paper' : 'text-paper-soft'}>
              {displayValue ?? 'None — pick a voice'}
            </span>
            <span className="text-paper-soft">▾</span>
          </button>

          {open ? (
            <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-white/10 bg-surface-raised">
              {loadState.status === 'loading' ? (
                <p className="px-3 py-2 text-sm text-paper-soft">Loading voices…</p>
              ) : loadState.status === 'error' ? (
                <div className="px-3 py-2">
                  <p className="mb-1 text-sm text-paper-soft">
                    Couldn&apos;t load the voice list — check your connection and Mistral account.
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

                  {loadState.status === 'loaded'
                    ? loadState.voices.map((voice) => (
                        <button
                          key={voice.id}
                          type="button"
                          aria-pressed={voice.id === value}
                          onClick={() => handleSelect(voice.id)}
                          className={`w-full px-3 py-2 text-left text-sm ${
                            voice.id === value
                              ? 'bg-white/5 text-paper'
                              : 'text-paper-soft hover:bg-white/[0.03] hover:text-paper'
                          }`}
                        >
                          {voice.name}
                        </button>
                      ))
                    : null}
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
