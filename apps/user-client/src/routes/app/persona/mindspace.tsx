// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MindspacePicker } from '../../../components/MindspacePicker.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useSettings } from '../../../data/settings.js';
import { useMindspaceStore } from '../../../state/mindspace.store.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Mindspace sub-page for a persona. Route: `/app/persona/:id/mindspace`.
 *
 * Hosts the MindspacePicker and seeds the live mindspace context
 * (useMindspaceStore) so the background and preview reflect the persona's
 * current colour and texture choices while the user is on this page.
 */
export function PersonaMindspace(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { onHelp, helpOverlay } = useHelp('persona-mindspace');
  const { persona, patch } = usePersonaEditing(id ?? null);
  const mindspaces = useMindspaces();
  const settings = useSettings();
  const setMindspace = useMindspaceStore((s) => s.update);

  // ── Seed the live mindspace context so the background preview is accurate ──
  useEffect(() => {
    if (!mindspaces.data || !settings.data || !persona) return;
    setMindspace({
      persona: { mindspaceId: persona.mindspaceId, textureOverride: persona.textureOverride },
      defaultMindspaceId: settings.data.defaultMindspaceId,
      defaultTexture: settings.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [persona, mindspaces.data, settings.data, setMindspace]);

  // ── Guard: unknown persona ────────────────────────────────────────────────
  if (persona === null) {
    const back = `/app/persona/${id ?? ''}`;
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: '/app/circle' }]} back={back}>
        <div
          data-testid="persona-mindspace"
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
          { label: 'Mindspace' },
        ]}
        back={`/app/persona/${id ?? ''}`}
      >
        <div data-testid="persona-mindspace" className="px-4 pt-4" />
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
        { label: 'Mindspace' },
      ]}
      back={back}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-mindspace" className="flex flex-col gap-6 px-4 pb-8 pt-4">
        {mindspaces.data ? (
          <MindspacePicker
            mindspaces={mindspaces.data}
            selectedMindspaceId={persona.mindspaceId}
            selectedTexture={persona.textureOverride ?? settings.data?.userTexture ?? 'cloudy'}
            previewName={persona.name || 'Persona'}
            allowUserDefault
            hideFont
            onMindspaceChange={(msId) => {
              const ms = msId ? mindspaces.data?.find((m) => m.id === msId) : null;
              void patch({ mindspaceId: msId, colour: ms?.palette.accent ?? persona.colour });
            }}
            onTextureChange={(t) => void patch({ textureOverride: t })}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}
