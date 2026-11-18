// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AutoSizeTextarea } from '../../../components/AutoSizeTextarea.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { Switch } from '../../../components/ui/Switch.js';
import { useHelp } from '../../../content/help/use-help.js';
import { greetingHelperGate } from '../../../lib/persona-hub.js';
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

  // Greeting-helper toggle: the background helper (set on the persona's main
  // screen) may write the opener too. Precedence-ordered disabled reason names
  // the true first blocker: roleplay off → greeting off → no helper set.
  const { disabled: greetingHelperDisabled, reason: greetingHelperReason } =
    greetingHelperGate(persona);

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
            <label htmlFor="persona-roleplay-switch" className="block text-sm text-paper">
              Roleplay
            </label>
            <p className="text-[11px] text-paper-soft">
              The persona becomes a roleplay character: fully in character, short conversational
              replies, narration between asterisks.
            </p>
          </div>
          <Switch
            id="persona-roleplay-switch"
            ariaLabel="Roleplay"
            checked={persona.roleplay}
            onChange={() => void patch({ roleplay: !persona.roleplay })}
          />
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
              <label htmlFor="persona-greeting-switch" className="block text-sm text-paper">
                Greeting
              </label>
              <p className="text-[11px] text-paper-soft">
                The persona opens every new chat with a freshly generated message following your
                rules below.
              </p>
            </div>
            <Switch
              id="persona-greeting-switch"
              ariaLabel="Greeting"
              checked={persona.greetingEnabled}
              disabled={!persona.roleplay}
              title={!persona.roleplay ? 'Enable Roleplay to set a greeting' : undefined}
              onChange={() => void patch({ greetingEnabled: !persona.greetingEnabled })}
              className="disabled:cursor-not-allowed disabled:opacity-40"
            />
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

          {/* Greeting-helper toggle — disabled-with-reason until a helper is set. */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <label htmlFor="persona-greeting-helper-switch" className="block text-sm text-paper">
                Let the helper write the greeting
              </label>
              <p className="text-[11px] text-paper-soft">
                Use the persona's background helper for the opener too, not just the background
                chores.
              </p>
            </div>
            <Switch
              id="persona-greeting-helper-switch"
              ariaLabel="Let the helper write the greeting"
              checked={persona.greetingUsesBackgroundModel ?? false}
              disabled={greetingHelperDisabled}
              title={greetingHelperReason}
              onChange={() =>
                void patch({
                  greetingUsesBackgroundModel: !(persona.greetingUsesBackgroundModel ?? false),
                })
              }
              className="disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
        </div>
      </div>
    </PageScaffold>
  );
}
