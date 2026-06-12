// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, listSttOfferings, listTtsOfferings } from '@chatsundere/llm-unified';
import type { SettingsRow } from '../../boot/client-data-db.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { REDEMPTION_MS_MAX, REDEMPTION_MS_MIN } from '../../lib/voice/dictation/vad-presets.js';
import { TtsModerationNotice } from './TtsModerationNotice.js';

// One Silero frame (1536 samples @ 16 kHz) ≈ 96 ms — the slider moves in whole frames.
const REDEMPTION_STEP_MS = 96;

type VoiceMode = SettingsRow['voiceMode'];
type DictationSensitivity = SettingsRow['dictationSensitivity'];

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
 * and shows the active TTS provider status line.
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

  const rows = providerRows ?? [];

  // ── TTS provider ────────────────────────────────────────────────────────────
  const ttsOfferings = listTtsOfferings();
  const ttsOffering = ttsOfferings[0];
  const ttsProviderDef = ttsOffering ? getProvider(ttsOffering.providerId) : null;
  const ttsProviderRow = ttsOffering
    ? rows.find((r) => r.templateId === ttsOffering.providerId && r.enabled)
    : null;

  const ttsOfferingLabel =
    ttsOffering && ttsProviderDef
      ? `${ttsOffering.tts?.displayName ?? ttsOffering.upstreamSlug} via ${ttsProviderDef.displayName}`
      : null;

  // ── STT provider ────────────────────────────────────────────────────────────
  const sttOfferings = listSttOfferings();
  const sttOffering = sttOfferings[0];
  const sttProviderDef = sttOffering ? getProvider(sttOffering.providerId) : null;
  const sttProviderRow = sttOffering
    ? rows.find((r) => r.templateId === sttOffering.providerId && r.enabled)
    : null;

  const sttOfferingLabel =
    sttOffering && sttProviderDef
      ? `${sttOffering.stt?.displayName ?? sttOffering.upstreamSlug} via ${sttProviderDef.displayName}`
      : null;

  return (
    <div className="flex flex-col gap-4">
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

      {/* ── TTS Provider ────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">Provider</div>
        {ttsProviderRow && ttsOfferingLabel ? (
          <p className="text-sm text-paper">{ttsOfferingLabel}</p>
        ) : ttsOffering && ttsProviderDef ? (
          <p className="text-sm text-paper-soft">
            Add the <span className="text-paper">{ttsProviderDef.displayName}</span> provider in My
            Settings to enable read-aloud.
          </p>
        ) : (
          <p className="text-sm text-paper-soft">No TTS provider is curated yet.</p>
        )}
        <div className="mt-2">
          <TtsModerationNotice />
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

        {/* STT Provider */}
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
            STT Provider
          </div>
          {sttProviderRow && sttOfferingLabel ? (
            <p className="text-sm text-paper">{sttOfferingLabel}</p>
          ) : sttOffering && sttProviderDef ? (
            <p className="text-sm text-paper-soft">
              Add the <span className="text-paper">{sttProviderDef.displayName}</span> provider in
              My Settings to dictate.
            </p>
          ) : (
            <p className="text-sm text-paper-soft">No STT provider is curated yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
