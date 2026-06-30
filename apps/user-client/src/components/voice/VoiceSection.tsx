// SPDX-License-Identifier: AGPL-3.0-only

import { type Offering, getProvider } from '@chatsundere/llm-unified';
import { useState } from 'react';
import type { ProviderRow, SettingsRow } from '../../boot/client-data-db.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { REDEMPTION_MS_MAX, REDEMPTION_MS_MIN } from '../../lib/voice/dictation/vad-presets.js';
import {
  type SelectedOffering,
  offeringRef,
  pickableSttOfferings,
  pickableTtsOfferings,
  selectSttOffering,
  selectTtsOffering,
} from '../../lib/voice/select-offering.js';
import {
  SPECTRUM_BARCOUNT_MAX,
  SPECTRUM_BARCOUNT_MIN,
  SPECTRUM_DEFAULTS,
  SPECTRUM_OPACITY_MAX,
  SPECTRUM_OPACITY_MIN,
  type SpectrumStyle,
  clampSpectrumBarCount,
  clampSpectrumOpacity,
} from '../../lib/voice/spectrum-settings.js';
import { OfferingSlotPicker, type SlotEntry } from './OfferingSlotPicker.js';
import { TtsModerationNotice } from './TtsModerationNotice.js';

// One Silero frame (1536 samples @ 16 kHz) ≈ 96 ms — the slider moves in whole frames.
const REDEMPTION_STEP_MS = 96;

type VoiceMode = SettingsRow['voiceMode'];
type DictationSensitivity = SettingsRow['dictationSensitivity'];

// Egress disclosure at the decision point (spec §5, Laura SOFT-5): each picker
// entry states where the data goes, so the privacy choice is a conscious one.
const EGRESS_NOTES: Record<string, string> = {
  'xai:grok-tts': 'Sends message text to xAI (US)',
  'nano-gpt:xai-tts': 'Sends message text via nano-gpt to xAI (US)',
  'xai:grok-stt': 'Sends microphone audio to xAI (US)',
  'nano-gpt:xai/speech-to-text/v1': 'Sends microphone audio via nano-gpt to xAI (US)',
  'mistral:voxtral-mini-latest': 'Sends microphone audio to Mistral AI (EU)',
};

/** "<offering> via <provider>" label, e.g. "Grok TTS via xAI". */
function offeringLabel(o: Offering): string {
  const providerName = getProvider(o.providerId)?.displayName ?? o.providerId;
  const meta = o.serviceKind === 'tts' ? o.tts : o.stt;
  return `${meta?.displayName ?? o.upstreamSlug} via ${providerName}`;
}

/** Build the slot-picker entries for a pickable offering list. */
function slotEntries(offerings: Offering[], rows: ProviderRow[]): SlotEntry[] {
  return offerings.map((o) => {
    const providerName = getProvider(o.providerId)?.displayName ?? o.providerId;
    return {
      refId: offeringRef(o),
      label: offeringLabel(o),
      egressNote: EGRESS_NOTES[offeringRef(o)] ?? '',
      configured: rows.some((r) => r.templateId === o.providerId && r.enabled),
      disabledHint: `Add the ${providerName} provider in My Settings to enable this.`,
    };
  });
}

/** The visible-auto-default label (spec §5.1, Laura SOFT-3), null for explicit picks. */
function autoLabel(selected: SelectedOffering | null): string | null {
  return selected?.auto === true ? offeringLabel(selected.offering) : null;
}

interface ModeOptionProps {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

/** A single interleave-mode option row. */
function ModeOption({ id, label, description, selected, onSelect }: ModeOptionProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-voice-mode={id}
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-paper bg-white/5 text-paper'
          : 'border-white/5 text-paper-soft hover:border-paper-soft/50'
      }`}
    >
      <div className="text-sm">{label}</div>
      <div className="mt-0.5 text-[11px] text-paper-soft">{description}</div>
    </button>
  );
}

/**
 * My Settings — voice read-aloud section.
 * Controls the interleave mode (paragraph / sentence) with immediate-persist semantics,
 * and the Read-aloud-voice / Speech-to-text slot pickers.
 * Also controls dictation settings: sensitivity, pause tolerance, and auto-send.
 */
export function VoiceSection(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();

  const voiceMode: VoiceMode = settings?.voiceMode ?? 'paragraph';
  const dictationSensitivity: DictationSensitivity = settings?.dictationSensitivity ?? 'medium';
  const dictationRedemptionMs: number = settings?.dictationRedemptionMs ?? 1_728;
  const dictationAutoSend: boolean = settings?.dictationAutoSend ?? false;

  const spectrumEnabled = settings?.spectrumEnabled ?? SPECTRUM_DEFAULTS.spectrumEnabled;
  const spectrumStyle: SpectrumStyle = settings?.spectrumStyle ?? SPECTRUM_DEFAULTS.spectrumStyle;
  const spectrumOpacity = settings?.spectrumOpacity ?? SPECTRUM_DEFAULTS.spectrumOpacity;
  const spectrumBarCount = settings?.spectrumBarCount ?? SPECTRUM_DEFAULTS.spectrumBarCount;
  const ttsHighpass = settings?.ttsHighpass ?? 'auto';
  const screenEffectsEnabled = settings?.screenEffectsEnabled ?? true;

  const rows = providerRows ?? [];

  // Plain state on purpose: leaving the settings room unmounts the section and
  // clears the slot-switch notice (spec §5, Laura SOFT-2 — no persistence).
  const [showTtsSwitchNote, setShowTtsSwitchNote] = useState(false);

  const ttsSelected = selectTtsOffering(settings?.ttsOffering ?? null, rows);
  const sttSelected = selectSttOffering(settings?.sttOffering ?? null, rows);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-paper-soft">
        How your Circle speaks and listens. One global choice for all personas — changes apply
        immediately.
      </p>

      {/* ── Read-aloud mode ─────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">
          Read-aloud mode
        </div>
        <div className="flex flex-col gap-2">
          <ModeOption
            id="paragraph"
            label="Paragraph"
            description="Reads a paragraph at a time — natural flow."
            selected={voiceMode === 'paragraph'}
            onSelect={() => update.mutate({ voiceMode: 'paragraph' })}
          />
          <ModeOption
            id="sentence"
            label="Sentence"
            description="Sentence by sentence — quicker first audio."
            selected={voiceMode === 'sentence'}
            onSelect={() => update.mutate({ voiceMode: 'sentence' })}
          />
        </div>
      </div>

      {/* ── Read-aloud voice slot ───────────────────────────────────────────── */}
      <div>
        <OfferingSlotPicker
          label="Read-aloud voice"
          subtitle="The voice that reads messages aloud."
          entries={slotEntries(pickableTtsOfferings(), rows)}
          value={settings?.ttsOffering ?? null}
          autoLabel={autoLabel(ttsSelected)}
          unconfiguredCopy="Add the xAI or nano-gpt provider to enable read-aloud."
          onSelect={(refId) => {
            // Re-picking the current value changes nothing — no note for a no-op.
            if (refId === (settings?.ttsOffering ?? null)) return;
            update.mutate({ ttsOffering: refId });
            setShowTtsSwitchNote(true);
          }}
        />
        {showTtsSwitchNote ? (
          <p className="mt-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-paper-soft">
            Personas keep their voice picks — if a voice came from the previous provider, re-pick it
            in the persona editor.
          </p>
        ) : null}
        <div className="mt-2">
          <TtsModerationNotice />
        </div>
      </div>

      {/* ── Voice cleanup (high-pass) ───────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">
          Voice cleanup
        </div>
        <div className="flex flex-col gap-2">
          <ModeOption
            id="hp-auto"
            label="Auto"
            description="Cleans up bass-heavy voices automatically (recommended)"
            selected={ttsHighpass === 'auto'}
            onSelect={() => update.mutate({ ttsHighpass: 'auto' })}
          />
          <ModeOption
            id="hp-off"
            label="Off"
            description="No filtering"
            selected={ttsHighpass === 'off'}
            onSelect={() => update.mutate({ ttsHighpass: 'off' })}
          />
          <ModeOption
            id="hp-50"
            label="50 Hz"
            description="Gentle low-end trim"
            selected={ttsHighpass === 50}
            onSelect={() => update.mutate({ ttsHighpass: 50 })}
          />
          <ModeOption
            id="hp-100"
            label="100 Hz"
            description="Stronger low-end trim"
            selected={ttsHighpass === 100}
            onSelect={() => update.mutate({ ttsHighpass: 100 })}
          />
        </div>
      </div>

      {/* ── Dictation ───────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">Dictation</div>

        {/* Sensitivity */}
        <div className="mb-3 flex flex-col gap-2">
          <ModeOption
            id="low"
            label="Low"
            description="Picks up quiet speech"
            selected={dictationSensitivity === 'low'}
            onSelect={() => update.mutate({ dictationSensitivity: 'low' })}
          />
          <ModeOption
            id="medium"
            label="Medium"
            description="Balanced (recommended)"
            selected={dictationSensitivity === 'medium'}
            onSelect={() => update.mutate({ dictationSensitivity: 'medium' })}
          />
          <ModeOption
            id="high"
            label="High"
            description="Ignores background noise"
            selected={dictationSensitivity === 'high'}
            onSelect={() => update.mutate({ dictationSensitivity: 'high' })}
          />
        </div>

        {/* Pause tolerance */}
        <div className="mb-3">
          <input
            type="range"
            min={REDEMPTION_MS_MIN}
            max={REDEMPTION_MS_MAX}
            step={REDEMPTION_STEP_MS}
            value={dictationRedemptionMs}
            aria-label="Pause tolerance"
            onChange={(e) => update.mutate({ dictationRedemptionMs: Number(e.target.value) })}
            className="w-full"
          />
          <span className="text-[11px] text-paper-soft">
            {(dictationRedemptionMs / 1000).toFixed(1)} s of silence ends an utterance
          </span>
        </div>

        {/* Auto-send */}
        <div className="mb-3">
          <button
            type="button"
            aria-pressed={dictationAutoSend}
            onClick={() => update.mutate({ dictationAutoSend: !dictationAutoSend })}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              dictationAutoSend
                ? 'border-paper bg-white/5 text-paper'
                : 'border-white/5 text-paper-soft hover:border-paper-soft/50'
            }`}
          >
            Auto-send
          </button>
          {dictationAutoSend && (
            <p className="mt-1.5 text-[11px] text-paper-soft">
              Each utterance sends immediately; there is no correction step.
            </p>
          )}
        </div>

        {/* Speech-to-text slot */}
        <OfferingSlotPicker
          label="Speech-to-text"
          subtitle="What turns your speech into text."
          entries={slotEntries(pickableSttOfferings(), rows)}
          value={settings?.sttOffering ?? null}
          autoLabel={autoLabel(sttSelected)}
          unconfiguredCopy="Add the Mistral AI, xAI or nano-gpt provider to dictate."
          onSelect={(refId) => update.mutate({ sttOffering: refId })}
        />
      </div>

      {/* ── Spectrum analyser ───────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">
          Spectrum analyser
        </div>

        {/* Enable */}
        <div className="mb-3">
          <button
            type="button"
            aria-pressed={spectrumEnabled}
            onClick={() => update.mutate({ spectrumEnabled: !spectrumEnabled })}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              spectrumEnabled
                ? 'border-paper bg-white/5 text-paper'
                : 'border-white/5 text-paper-soft hover:border-paper-soft/50'
            }`}
          >
            Show the spectrum analyser
          </button>
          <p className="mt-1.5 text-[11px] text-paper-soft">
            An ambient equaliser that pulses to your Circle's voice while it reads aloud.
          </p>
        </div>

        {spectrumEnabled && (
          <>
            {/* Style (sharp / soft / glow) */}
            <div className="mb-3 flex flex-col gap-2">
              <ModeOption
                id="sharp"
                label="Sharp"
                description="Crisp solid bars"
                selected={spectrumStyle === 'sharp'}
                onSelect={() => update.mutate({ spectrumStyle: 'sharp' })}
              />
              <ModeOption
                id="soft"
                label="Soft"
                description="Gradient bars (recommended)"
                selected={spectrumStyle === 'soft'}
                onSelect={() => update.mutate({ spectrumStyle: 'soft' })}
              />
              <ModeOption
                id="glow"
                label="Glow"
                description="Luminous bars with a halo"
                selected={spectrumStyle === 'glow'}
                onSelect={() => update.mutate({ spectrumStyle: 'glow' })}
              />
            </div>

            {/* Opacity */}
            <div className="mb-3">
              <input
                type="range"
                min={SPECTRUM_OPACITY_MIN}
                max={SPECTRUM_OPACITY_MAX}
                step={0.05}
                value={spectrumOpacity}
                aria-label="Spectrum opacity"
                onChange={(e) =>
                  update.mutate({ spectrumOpacity: clampSpectrumOpacity(Number(e.target.value)) })
                }
                className="w-full"
              />
              <span className="text-[11px] text-paper-soft">
                Opacity {Math.round(spectrumOpacity * 100)}%
              </span>
            </div>

            {/* Bar count */}
            <div className="mb-3">
              <input
                type="range"
                min={SPECTRUM_BARCOUNT_MIN}
                max={SPECTRUM_BARCOUNT_MAX}
                step={1}
                value={spectrumBarCount}
                aria-label="Spectrum bar count"
                onChange={(e) =>
                  update.mutate({ spectrumBarCount: clampSpectrumBarCount(Number(e.target.value)) })
                }
                className="w-full"
              />
              <span className="text-[11px] text-paper-soft">{spectrumBarCount} bars</span>
            </div>
          </>
        )}
      </div>

      {/* ── Screen effects ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-widest text-paper-soft">
          Screen effects
        </div>
        <div className="mb-3">
          <button
            type="button"
            aria-pressed={screenEffectsEnabled}
            onClick={() => update.mutate({ screenEffectsEnabled: !screenEffectsEnabled })}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              screenEffectsEnabled
                ? 'border-paper bg-white/5 text-paper'
                : 'border-white/5 text-paper-soft hover:border-paper-soft/50'
            }`}
          >
            Show screen effects
          </button>
          <p className="mt-1.5 text-[11px] text-paper-soft">
            Brief emoji showers your Circle can sprinkle into a reply — a celebration, a flirt, a
            punchline.
          </p>
        </div>
      </div>
    </div>
  );
}
