// SPDX-License-Identifier: AGPL-3.0-only

import { getOffering } from '@chatsundere/llm-unified';
import { Link, useParams } from 'react-router-dom';
import { ContextWindowControl } from '../../../components/persona-editor/ContextWindowControl.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useProviders } from '../../../data/providers.js';
import { useSettings } from '../../../data/settings.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Model behaviour sub-page for a persona. Route: `/app/persona/:id/model`.
 *
 * Covers Temperature, Context Window, and the Ask an Expert by default toggle.
 * All fields save immediately (always-save).
 */
export function PersonaModelBehaviour(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-model');
  const { persona, patch } = usePersonaEditing(id ?? null);
  const providers = useProviders();
  const settings = useSettings();

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    const back = `/app/persona/${id ?? ''}`;
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-model-behaviour"
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
          { label: 'Model behaviour' },
        ]}
        back={`/app/persona/${id ?? ''}`}
      >
        <div data-testid="persona-model-behaviour" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  const back = `/app/persona/${id}`;

  // Resolve the offering for the context-window control.
  const prov = providers.data?.find((p) => p.id === persona.providerId);
  const off = prov && persona.modelId ? getOffering(prov.templateId, persona.modelId) : undefined;

  const expertMissing = settings.data?.expertModel == null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Circle', to: '/app/circle' },
        { label: persona.name || 'Persona', to: back },
        { label: 'Model behaviour' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-model-behaviour" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        {/* 1. Temperature ──────────────────────────────────────────────────── */}
        <div>
          <label
            htmlFor="persona-temperature"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            Temperature
          </label>
          <div className="flex items-center gap-3">
            <input
              id="persona-temperature"
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={persona.temperature}
              onChange={(e) => void patch({ temperature: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-12 text-center font-mono text-sm text-paper">
              {persona.temperature.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-paper-soft">
            Default 0.85 · range 0.00 – 2.00 in 0.05 steps. Higher = more creative chaos.
          </p>
        </div>

        {/* 2. Context window ───────────────────────────────────────────────── */}
        {off ? (
          <ContextWindowControl
            offering={off}
            value={persona.contextWindow}
            onChange={(n) => void patch({ contextWindow: n })}
          />
        ) : (
          <p className="text-[11px] text-paper-soft">
            Pick a model on the hub to tune its context window.
          </p>
        )}

        {/* 3. Ask an expert by default ─────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-paper">Ask an expert by default</div>
            <p className="text-[11px] text-paper-soft">
              Default for new chats; override per chat from the cockpit.
            </p>
          </div>
          <button
            type="button"
            aria-label="Ask an expert by default"
            aria-pressed={persona.askExpertDefault}
            disabled={expertMissing}
            title={expertMissing ? 'Choose a global expert model in Settings first.' : undefined}
            onClick={() => void patch({ askExpertDefault: !persona.askExpertDefault })}
            className={`h-6 w-12 shrink-0 rounded-full border ${
              persona.askExpertDefault
                ? 'border-paper bg-paper/30'
                : 'border-paper-soft/30 bg-white/5'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
                persona.askExpertDefault ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </PageScaffold>
  );
}
