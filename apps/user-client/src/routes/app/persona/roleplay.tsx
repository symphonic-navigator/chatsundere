// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AutoSizeTextarea } from '../../../components/AutoSizeTextarea.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Roleplay sub-page for a persona. Route: `/app/persona/:id/roleplay`.
 *
 * Covers the Roleplay on/off toggle, Narration perspective (segmented control),
 * and the Greeting block (greeting toggle + greeting-rules textarea). All fields
 * save immediately (always-save); greeting instructions persist on blur.
 *
 * Narration and Greeting are always visible. When Roleplay is off they are
 * shown disabled-with-reason (disabled-over-hidden UX principle).
 */
export function PersonaRoleplay(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-roleplay');
  const { persona, patch } = usePersonaEditing(id ?? null);

  // Local draft for the greeting instructions textarea — changes are held
  // locally and committed on blur so we do not write on every keystroke.
  const [greetingText, setGreetingText] = useState('');

  useEffect(() => {
    setGreetingText(persona?.greetingInstructions ?? '');
  }, [persona?.greetingInstructions]);

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    const back = `/app/persona/${id ?? ''}`;
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-roleplay"
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
          { label: 'Roleplay' },
        ]}
        back={`/app/persona/${id ?? ''}`}
      >
        <div data-testid="persona-roleplay" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  const back = `/app/persona/${id}`;
  // Amber cue: greeting is on but rules are empty — the opener cannot compose anything.
  const greetingInvalid = persona.greetingEnabled && greetingText.trim() === '';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Circle', to: '/app/circle' },
        { label: persona.name || 'Persona', to: back },
        { label: 'Roleplay' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-roleplay" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        {/* 1. Roleplay toggle ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Roleplay</div>
            <p className="text-[11px] text-paper-soft">
              The persona becomes a roleplay character: fully in character, short conversational
              replies, narration between asterisks.
            </p>
          </div>
          <button
            type="button"
            aria-label="Roleplay"
            aria-pressed={persona.roleplay}
            onClick={() => void patch({ roleplay: !persona.roleplay })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              persona.roleplay ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                persona.roleplay ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 2. Narration perspective — always visible, disabled when roleplay off ── */}
        <div>
          <div className="mb-2 text-xs uppercase tracking-wider text-paper-soft">Narration</div>
          <div className="cs-segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={persona.narration === 'first'}
              data-active={persona.narration === 'first' || undefined}
              className="cs-seg"
              disabled={!persona.roleplay}
              title={
                !persona.roleplay
                  ? 'Enable Roleplay to choose the narration perspective'
                  : undefined
              }
              onClick={() => void patch({ narration: 'first' })}
            >
              First person
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={persona.narration === 'third'}
              data-active={persona.narration === 'third' || undefined}
              className="cs-seg"
              disabled={!persona.roleplay}
              title={
                !persona.roleplay
                  ? 'Enable Roleplay to choose the narration perspective'
                  : undefined
              }
              onClick={() => void patch({ narration: 'third' })}
            >
              Third person
            </button>
          </div>
        </div>

        {/* 3. Greeting — always visible, disabled when roleplay off ─────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-paper">Greeting</div>
              <p className="text-[11px] text-paper-soft">
                The persona opens every new chat with a freshly generated message following your
                rules below.
              </p>
            </div>
            <button
              type="button"
              aria-label="Greeting"
              aria-pressed={persona.greetingEnabled}
              disabled={!persona.roleplay}
              title={!persona.roleplay ? 'Enable Roleplay to set a greeting' : undefined}
              onClick={() => void patch({ greetingEnabled: !persona.greetingEnabled })}
              className={`h-6 w-12 shrink-0 rounded-full border ${
                persona.greetingEnabled
                  ? 'border-paper bg-paper/30'
                  : 'border-paper-soft/30 bg-white/5'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                  persona.greetingEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <AutoSizeTextarea
            aria-label="Greeting rules"
            minRows={3}
            maxRows={12}
            value={greetingText}
            onChange={setGreetingText}
            onBlur={(v) => void patch({ greetingInstructions: v })}
            disabled={!persona.roleplay || !persona.greetingEnabled}
            placeholder="Greet the user as if you had just discovered them on OkCupid."
          />

          {greetingInvalid ? (
            <p className="text-[11px] text-amber-300/80">
              Write the greeting rules, or turn the greeting off.
            </p>
          ) : null}
        </div>
      </div>
    </PageScaffold>
  );
}
