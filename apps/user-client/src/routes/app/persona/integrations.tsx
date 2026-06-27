// SPDX-License-Identifier: AGPL-3.0-only

import { Link, useParams } from 'react-router-dom';
import { McpOverrideSection } from '../../../components/persona-editor/McpOverrideSection.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMcpServers } from '../../../data/mcp-servers.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Integrations sub-page for a persona. Route: `/app/persona/:id/integrations`.
 *
 * Hosts the per-persona MCP server override control. Framed for future
 * integrations beyond MCP.
 */
export function PersonaIntegrations(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-integrations');
  const { persona, patch } = usePersonaEditing(id ?? null);
  const mcpServers = useMcpServers();

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    const back = `/app/persona/${id ?? ''}`;
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-integrations"
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
          { label: 'Integrations' },
        ]}
        back={`/app/persona/${id ?? ''}`}
      >
        <div data-testid="persona-integrations" className="px-4 pt-4" />
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
        { label: 'Integrations' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-integrations" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        <p className="text-[11px] text-paper-soft">
          Per-persona tools — choose which MCP servers this persona may use.
        </p>
        <McpOverrideSection
          servers={mcpServers.data ?? []}
          overrides={persona.mcpOverrides}
          onChange={(next) => patch({ mcpOverrides: next })}
        />
      </div>
    </PageScaffold>
  );
}
