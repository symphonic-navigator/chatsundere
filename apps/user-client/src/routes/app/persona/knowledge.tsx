// SPDX-License-Identifier: AGPL-3.0-only

import { Link, useParams } from 'react-router-dom';
import { KnowledgeSection } from '../../../components/persona-editor/KnowledgeSection.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Knowledge sub-page for a persona. Route: `/app/persona/:id/knowledge`.
 *
 * Hosts the knowledge-base library assignment control. The persona's
 * `libraryIds` are toggled here; the editing state saves on every change
 * via `patch` (always-save pattern).
 */
export function PersonaKnowledge(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-knowledge');
  const { persona, patch } = usePersonaEditing(id ?? null);

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    const back = `/app/persona/${id ?? ''}`;
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-knowledge"
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
          { label: 'Knowledge' },
        ]}
        back={`/app/persona/${id ?? ''}`}
      >
        <div data-testid="persona-knowledge" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  const back = `/app/persona/${id}`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageScaffold
      crumbs={[
        { label: 'My Circle', to: '/app/circle' },
        { label: persona.name || 'Persona', to: back },
        { label: 'Knowledge' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-knowledge" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        <p className="text-[11px] text-paper-soft">
          Assign knowledge-base libraries this persona can draw on.
        </p>
        <KnowledgeSection
          selected={persona.libraryIds ?? []}
          onChange={(ids) => patch({ libraryIds: ids })}
          adultPersona={persona.adultPersona}
        />
      </div>
    </PageScaffold>
  );
}
