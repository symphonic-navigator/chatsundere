// SPDX-License-Identifier: AGPL-3.0-only

import { type TtsVoice, listTtsVoices } from '@chatsundere/llm-unified';
import { useEffect, useState } from 'react';
import { resolveTtsTransport } from '../../lib/voice/resolve-tts.js';

// Module-level memo keyed by offering ref: one fetch per offering per session,
// shared across all picker instances. Switching the TTS slot re-resolves.
const voicesPromises = new Map<string, Promise<TtsVoice[]>>();

/** Reset the cached voices promises. Exposed for tests only. */
export function _resetVoicePickerCacheForTests(): void {
  voicesPromises.clear();
}

/**
 * Fetch the active offering's TTS voices, reusing the cached promise on
 * subsequent calls. Clears that offering's cache and retries on failure when
 * `retry` is true.
 */
async function fetchVoices(retry = false): Promise<TtsVoice[]> {
  const transport = await resolveTtsTransport();
  if (!transport) return [];
  const meta = transport.ttsMeta;
  // nano-gpt exposes no voice-list endpoint; its offering carries the list.
  if (meta.voices.kind === 'static') return [...meta.voices.list];
  const ref = `${transport.offering.providerId}:${transport.offering.upstreamSlug}`;
  if (retry) voicesPromises.delete(ref);
  let promise = voicesPromises.get(ref);
  if (!promise) {
    promise = listTtsVoices({
      providerConfig: transport.providerConfig,
      apiKey: transport.apiKey,
      corsProxyUrl: transport.corsProxyUrl,
      corsProxyKey: transport.corsProxyKey,
      endpoint: meta.voices.endpoint,
      signal: AbortSignal.timeout(15_000),
    });
    voicesPromises.set(ref, promise);
    // On failure, clear the memo so the next call can retry — but only if this
    // promise still owns the slot; a stale rejection arriving after a retry has
    // replaced it must not evict the newer in-flight promise.
    promise.catch(() => {
      if (voicesPromises.get(ref) === promise) voicesPromises.delete(ref);
    });
  }
  return promise;
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

  // Resolve the selected voice's display NAME without requiring the user to open
  // the picker. Voices load lazily on open, but the collapsed trigger needs the
  // name now — otherwise it shows the raw voice id (device finding 2026-06-12).
  // The fetch is session-memoised (one network call shared across pickers), so
  // eager resolution is cheap; it runs only when a voice is selected, the control
  // is enabled, and nothing has been loaded yet.
  useEffect(() => {
    if (disabled || value === null) return;
    let cancelled = false;
    // Functional update (not a `loadState` dep) so the effect runs only when the
    // value/disabled inputs change — adding `status` would re-run the effect on
    // the idle→loading flip and its cleanup would cancel its own in-flight fetch.
    setLoadState((prev) => (prev.status === 'loaded' ? prev : { status: 'loading' }));
    fetchVoices().then(
      (voices) => {
        if (!cancelled) setLoadState({ status: 'loaded', voices });
      },
      () => {
        if (!cancelled) setLoadState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [disabled, value]);

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
  // While the name is still resolving, show a neutral placeholder rather than the
  // raw id. Once loaded we use the name, falling back to the id only if the stored
  // voice vanished upstream (or the list failed to load) — an honest last resort.
  const resolving =
    value !== null && (loadState.status === 'idle' || loadState.status === 'loading');
  const displayValue = selectedVoice?.name ?? (resolving ? '…' : (value ?? null));

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
