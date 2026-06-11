// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, listTtsOfferings } from '@chatsundere/llm-unified';
import type { SettingsRow } from '../../boot/client-data-db.js';
import { useProviders } from '../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';

type VoiceMode = SettingsRow['voiceMode'];

interface ModeOptionProps {
  id: VoiceMode;
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
 */
export function VoiceSection(): JSX.Element {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();

  const voiceMode: VoiceMode = settings?.voiceMode ?? 'paragraph';

  // Determine whether a TTS provider is configured and what it looks like.
  const ttsOfferings = listTtsOfferings();
  const ttsOffering = ttsOfferings[0];
  const ttsProviderDef = ttsOffering ? getProvider(ttsOffering.providerId) : null;
  const rows = providerRows ?? [];
  const ttsProviderRow = ttsOffering
    ? rows.find((r) => r.templateId === ttsOffering.providerId && r.enabled)
    : null;

  const offeringLabel =
    ttsOffering && ttsProviderDef
      ? `${ttsOffering.tts?.displayName ?? ttsOffering.upstreamSlug} via ${ttsProviderDef.displayName}`
      : null;

  return (
    <div className="flex flex-col gap-4">
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

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">Provider</div>
        {ttsProviderRow && offeringLabel ? (
          <p className="text-sm text-paper">{offeringLabel}</p>
        ) : ttsOffering && ttsProviderDef ? (
          <p className="text-sm text-paper-soft">
            Add the <span className="text-paper">{ttsProviderDef.displayName}</span> provider in My
            Settings to enable read-aloud.
          </p>
        ) : (
          <p className="text-sm text-paper-soft">No TTS provider is curated yet.</p>
        )}
      </div>
    </div>
  );
}
