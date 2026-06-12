// SPDX-License-Identifier: AGPL-3.0-only

import { listTtsOfferings } from '@chatsundere/llm-unified';

/**
 * A standing notice that the curated TTS provider is content-moderated and may
 * decline benign passages (e.g. Mistral Voxtral's 403s on innocuous text).
 * Chatsundere's stance is anti-censorship and honest: we surface this rather
 * than hide it, and pair it with read-aloud's auto-skip behaviour so a refusal
 * never halts the read. Renders null when the curated offering is not moderated
 * (a future uncensored provider) or when no TTS offering is curated.
 */
export function TtsModerationNotice(): JSX.Element | null {
  const offering = listTtsOfferings()[0];
  if (!offering?.tts?.contentModerated) return null;

  return (
    <p className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[11px] leading-relaxed text-paper-soft">
      Heads up — the voice provider applies content moderation and may decline some passages, even
      harmless ones. Read-aloud skips a declined passage and carries on.
    </p>
  );
}
