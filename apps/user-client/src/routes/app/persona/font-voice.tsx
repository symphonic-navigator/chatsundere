// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { TtsModerationNotice } from '../../../components/voice/TtsModerationNotice.js';
import { VoicePicker } from '../../../components/voice/VoicePicker.js';
import { useHelp } from '../../../content/help/use-help.js';
import { safeReturnPath } from '../../../lib/safe-return.js';
import { resolveTtsTransport } from '../../../lib/voice/resolve-tts.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Font & Voice sub-page for a persona. Route: `/app/persona/:id/font-voice`.
 *
 * Covers the font selector (sans / serif / cursive, each displayed in its own
 * typeface) and the TTS voice pickers (main voice + narrator voice when
 * roleplay is on). All fields save immediately (always-save).
 */
export function PersonaFontVoice(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-font-voice');
  const { persona, patch } = usePersonaEditing(id ?? null);
  const location = useLocation();
  const [search] = useSearchParams();
  // A sender (e.g. the chat's voice note) passes `?return=`; without one, Back
  // is the persona hub.
  const back = safeReturnPath(search.get('return'), `/app/persona/${id ?? ''}`);
  const here = encodeURIComponent(`${location.pathname}${location.search}`);

  // One-time probe: resolve whether a TTS provider is configured. null = still
  // probing (treated as enabled so the picker isn't prematurely locked during
  // load); false = no provider.
  const [hasTtsProvider, setHasTtsProvider] = useState<boolean | null>(null);
  const [serviceLabel, setServiceLabel] = useState<string | null>(null);
  useEffect(() => {
    void resolveTtsTransport()
      .then((t) => {
        setHasTtsProvider(t !== null);
        if (t) {
          const providerName =
            getProvider(t.offering.providerId)?.displayName ?? t.offering.providerId;
          setServiceLabel(`${t.ttsMeta.displayName} via ${providerName}`);
        }
      })
      .catch(() => setHasTtsProvider(false));
  }, []);

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-font-voice"
          className="flex flex-col items-center gap-4 px-4 pt-16 text-center"
        >
          <p className="text-paper-soft">Persona not found.</p>
          <Link to={`/app/persona/${id ?? ''}`} className="text-sm text-paper underline">
            Back to Persona
          </Link>
        </div>
      </PageScaffold>
    );
  }

  // ── Guard: still loading ──────────────────────────────────────────────────
  if (persona === undefined) {
    return (
      <PageScaffold
        crumbs={[
          { label: 'My Circle', to: '/app/circle' },
          { label: 'Persona', to: `/app/persona/${id ?? ''}` },
          { label: 'Font & Voice' },
        ]}
        back={back}
      >
        <div data-testid="persona-font-voice" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  const hub = `/app/persona/${id}`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Circle', to: '/app/circle' },
        { label: persona.name || 'Persona', to: hub },
        { label: 'Font & Voice' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-font-voice" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        {/* 1. Font selector ────────────────────────────────────────────────── */}
        <div>
          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Font</div>
          <div className="cs-segmented" role="tablist">
            {(['sans', 'serif', 'cursive'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={persona.font === f}
                data-active={persona.font === f || undefined}
                className={`cs-seg ${f === 'sans' ? 'font-sans' : f === 'serif' ? 'font-display' : 'italic font-display'}`}
                onClick={() => void patch({ font: f })}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-paper-soft">
            Font is the persona&apos;s visual voice — serif for informal, sans for formal, cursive
            for dolce vita.
          </p>
        </div>

        {/* 2. Voice block ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {serviceLabel ? (
            <p data-testid="voice-service-line" className="text-[11px] text-paper-soft">
              Voices from {serviceLabel} ·{' '}
              <Link to={`/app/settings/voice?return=${here}`} className="underline">
                change in My Settings → Voice
              </Link>
            </p>
          ) : null}
          <TtsModerationNotice />
          <VoicePicker
            label="Voice"
            value={persona.voice}
            onSelect={(v) => void patch({ voice: v })}
            disabled={hasTtsProvider === false}
            disabledHint="Add a voice provider (xAI, nano-gpt or ElevenLabs) in My Settings to enable voice."
          />
          {persona.roleplay ? (
            <div>
              <VoicePicker
                label="Narrator voice"
                value={persona.narratorVoice}
                onSelect={(v) => void patch({ narratorVoice: v })}
                disabled={hasTtsProvider === false}
                disabledHint="Add a voice provider (xAI, nano-gpt or ElevenLabs) in My Settings to enable voice."
              />
              <p className="mt-1 text-[11px] text-paper-soft">
                Used for <em>asterisk narration</em> in roleplay; defaults to the main voice.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </PageScaffold>
  );
}
