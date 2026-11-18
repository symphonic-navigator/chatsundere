// SPDX-License-Identifier: AGPL-3.0-only

import { Link, useParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Switch } from '../../../components/ui/Switch.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useSettings } from '../../../data/settings.js';
import { DEFAULT_PERSONA_INSTRUCTIONS } from '../../../lib/persona-defaults.js';
import { InlineEditTextarea } from '../settings/InlineEditTextarea.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Instructions sub-page for a persona. Route: `/app/persona/:id/instructions`.
 *
 * Covers Chatsundere Tonality, Adult Persona, Custom Instructions, and the
 * per-persona About Me override. All fields save immediately on blur (always-save).
 */
export function PersonaInstructions(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-instructions');
  const { persona, patch } = usePersonaEditing(id ?? null);
  const settings = useSettings();

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    const back = `/app/persona/${id ?? ''}`;
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-instructions"
          className="flex flex-col items-center gap-4 px-4 pt-16 text-center"
        >
          <p className="text-paper-soft">Persona not found.</p>
          <Link to={back} className="text-sm text-paper underline">
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
          { label: 'Instructions' },
        ]}
        back={`/app/persona/${id ?? ''}`}
      >
        <div data-testid="persona-instructions" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  const back = `/app/persona/${id}`;
  const instructionsEmpty = persona.instructions.trim() === '';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Circle', to: '/app/circle' },
        { label: persona.name || 'Persona', to: back },
        { label: 'Instructions' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-instructions" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        {/* 1. Chatsundere Tonality toggle ─────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <label htmlFor="persona-tonality-switch" className="block text-sm text-paper">
              Chatsundere Tonality
            </label>
            <p className="text-[11px] text-paper-soft">
              The curated Chatsundere voice — open, uncensored on topics, expressive. On by default.
              Turn off for a plainer persona.
            </p>
          </div>
          <Switch
            id="persona-tonality-switch"
            ariaLabel="Chatsundere tonality"
            checked={persona.chatsundereTonality}
            onChange={() => void patch({ chatsundereTonality: !persona.chatsundereTonality })}
          />
        </div>

        {/* 2. Adult Persona toggle ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <label htmlFor="persona-adult-switch" className="block text-sm text-paper">
              Adult Persona
            </label>
            <p className="text-[11px] text-paper-soft">
              Hidden when sanitised mode is active, and unlocks explicit content in this persona's
              system prompt. Refine the tone further via custom instructions.
            </p>
          </div>
          <Switch
            id="persona-adult-switch"
            ariaLabel="Adult persona"
            checked={persona.adultPersona}
            onChange={() => void patch({ adultPersona: !persona.adultPersona })}
          />
        </div>

        {/* 3. Custom Instructions ──────────────────────────────────────────── */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-paper-soft">
              Custom Instructions
            </span>
            {instructionsEmpty ? (
              <span className="text-[11px] text-paper-soft/70">— Needs setup</span>
            ) : null}
          </div>
          <InlineEditTextarea
            label="Custom Instructions"
            value={persona.instructions}
            helper="Who this persona is."
            clearOnFocusValue={DEFAULT_PERSONA_INSTRUCTIONS}
            placeholder={DEFAULT_PERSONA_INSTRUCTIONS}
            minRows={5}
            onSave={(v) => patch({ instructions: v })}
          />
        </div>

        {/* 4. What the model knows about you ──────────────────────────────── */}
        <InlineEditTextarea
          label="What the model knows about you"
          value={persona.aboutMeOverride ?? ''}
          placeholder={settings.data?.globalAboutMe || 'Tell this persona who you are…'}
          helper="Empty = your global About Me is used. Fill in to override for this persona only."
          minRows={4}
          onSave={(v) => patch({ aboutMeOverride: v === '' ? null : v })}
        />
      </div>
    </PageScaffold>
  );
}
