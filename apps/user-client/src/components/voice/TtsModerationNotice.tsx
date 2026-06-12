// SPDX-License-Identifier: AGPL-3.0-only

import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { selectTtsOffering } from '../../lib/voice/select-offering.js';

/**
 * A standing notice that the SELECTED TTS offering is content-moderated and may
 * decline benign passages. Renders null when the active offering synthesises
 * whatever it is given (both Grok paths — probed 2026-06-12) or when nothing
 * resolves. The mechanism outlives the Mistral-TTS GUI removal on purpose: any
 * future moderated offering lights it up again.
 */
export function TtsModerationNotice(): JSX.Element | null {
  const { data: settings } = useSettings();
  const { data: providerRows } = useProviders();
  const selected = selectTtsOffering(settings?.ttsOffering ?? null, providerRows ?? []);
  if (!selected?.offering.tts?.contentModerated) return null;

  return (
    <p className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[11px] leading-relaxed text-paper-soft">
      Heads up — the voice provider applies content moderation and may decline some passages, even
      harmless ones. Read-aloud skips a declined passage and carries on.
    </p>
  );
}
