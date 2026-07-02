// SPDX-License-Identifier: AGPL-3.0-only

import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Brain,
  Drama,
  Plug,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Type,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AvatarCropModal } from '../../../components/AvatarCropModal.js';
import { ModelSlotPicker } from '../../../components/ModelSlotPicker.js';
import { AvatarField, type PendingAvatar } from '../../../components/persona-editor/AvatarField.js';
import {
  type AppliedPersonaImport,
  ChatsuneImportControl,
} from '../../../components/persona-editor/ChatsuneImportControl.js';
import { PostImportNote } from '../../../components/persona-editor/PostImportNote.js';
import { ExportOverlay } from '../../../components/transfer/ExportOverlay.js';
import { Button } from '../../../components/ui/Button.js';
import { NavTile } from '../../../components/ui/NavTile.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useChats } from '../../../data/chats.js';
import { importChatsuneMemory, importChatsuneSessions } from '../../../data/chatsune-import.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useRemovePersonaAvatar, useSetPersonaAvatar } from '../../../data/persona-avatars.js';
import { useProviders } from '../../../data/providers.js';
import { QK } from '../../../data/queryKeys.js';
import { useSettings } from '../../../data/settings.js';
import { normaliseAvatar } from '../../../lib/avatar-normalise.js';
import { resolveImportedNsfw } from '../../../lib/chatsune-import/nsfw.js';
import { FONT_VAR } from '../../../lib/persona-font.js';
import {
  fontVoiceMeta,
  instructionsMeta,
  integrationsMeta,
  isPersonaIncomplete,
  knowledgeMeta,
  memoryMeta,
  mindspaceMeta,
  missingRequirement,
  modelBehaviourMeta,
  roleplayMeta,
} from '../../../lib/persona-hub.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';
import { useMindspaceStore } from '../../../state/mindspace.store.js';
import { toastStore } from '../../../state/toast.store.js';
import { InlineEditRow } from '../account/InlineEditRow.js';
import { usePersonaEditing } from './use-persona-editing.js';

/**
 * Hub page for an existing persona — the home screen for configuring and
 * launching chats with a persona. Route: `/app/persona/:id`.
 *
 * Its root element carries `data-testid="persona-hub"` so the create-step test
 * can assert navigation by finding this sentinel.
 */
export function PersonaHub(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const returnPath = search.get('return') ?? '/app/circle';
  const { onHelp, helpOverlay } = useHelp('persona');

  // Present when navigating here from a Chatsundere persona pack import — drives
  // the one-time PostImportNote (ported from persona-editor.tsx).
  const justImported =
    location.state !== null &&
    typeof location.state === 'object' &&
    'justImported' in (location.state as Record<string, unknown>)
      ? (location.state as { justImported: { modelBound: boolean; droppedBindings: boolean } })
          .justImported
      : null;
  const [showExportOverlay, setShowExportOverlay] = useState(false);

  const {
    persona,
    patch,
    disabled: editDisabled,
    tooltip: editTooltip,
  } = usePersonaEditing(id ?? null);
  const chats = useChats();
  const mindspaces = useMindspaces();
  const settings = useSettings();
  const hasProxy = useServerGate('proxy').enabled;
  const providers = useProviders();
  const qc = useQueryClient();

  const setAvatarMut = useSetPersonaAvatar();
  const removeAvatarMut = useRemovePersonaAvatar();
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>(null);
  const [cropState, setCropState] = useState<{
    url: string;
    width: number;
    height: number;
    blob: Blob;
    mime: string;
  } | null>(null);

  const setMindspace = useMindspaceStore((s) => s.update);

  // Seed the live mindspace context from this persona's override (or the user
  // default) so background tinting reflects the active persona — ported from
  // persona-editor.tsx.
  useEffect(() => {
    if (!persona || !mindspaces.data || !settings.data) return;
    setMindspace({
      persona: { mindspaceId: persona.mindspaceId, textureOverride: persona.textureOverride },
      defaultMindspaceId: settings.data.defaultMindspaceId,
      defaultTexture: settings.data.userTexture,
      mindspaces: mindspaces.data,
    });
  }, [persona, mindspaces.data, settings.data, setMindspace]);

  // ── Guard: unknown persona ──────────────────────────────────────────────────
  if (persona === null) {
    return (
      <PageScaffold crumbs={[{ label: 'My Circle', to: returnPath }]} back={returnPath}>
        <div
          data-testid="persona-hub"
          className="flex flex-col items-center gap-4 px-4 pt-16 text-center"
        >
          <p className="text-paper-soft">Persona not found.</p>
          <Link to={returnPath} className="text-sm text-paper underline">
            Back to My Circle
          </Link>
        </div>
      </PageScaffold>
    );
  }

  // ── Guard: still loading ────────────────────────────────────────────────────
  if (persona === undefined) {
    return (
      <PageScaffold
        crumbs={[{ label: 'My Circle', to: returnPath }, { label: 'Persona' }]}
        back={returnPath}
      >
        <div data-testid="persona-hub" className="px-4 pt-4" />
      </PageScaffold>
    );
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const incomplete = isPersonaIncomplete(persona);
  const recentChat = chats.data?.find((c) => c.personaId === id) ?? null;

  // Gold logic: at most one affirmative highlight per screen (spec §2.2).
  const continueGold = !incomplete && recentChat !== null;
  const newChatGold = !incomplete && recentChat === null;

  const providerRow = providers.data?.find((p) => p.id === persona.providerId);
  const currentModel =
    providerRow && persona.modelId
      ? { providerTemplateId: providerRow.templateId, upstreamSlug: persona.modelId }
      : null;

  // ── Avatar handlers (always-save) ───────────────────────────────────────────

  async function onPickAvatar(file: File): Promise<void> {
    try {
      const n = await normaliseAvatar(file);
      setCropState({
        url: URL.createObjectURL(n.blob),
        width: n.width,
        height: n.height,
        blob: n.blob,
        mime: n.mime,
      });
    } catch (e) {
      toastStore.show({ message: (e as Error).message, tone: 'warn', durationMs: 3500 });
    }
  }

  async function confirmCrop(crop: { x: number; y: number; zoom: number }): Promise<void> {
    if (!id || !cropState) return;
    const pendingAv: PendingAvatar = {
      blob: cropState.blob,
      mime: cropState.mime,
      width: cropState.width,
      height: cropState.height,
      crop,
    };
    setPendingAvatar(pendingAv);
    URL.revokeObjectURL(cropState.url);
    setCropState(null);
    try {
      await setAvatarMut.mutateAsync({ personaId: id, ...pendingAv });
    } catch (e) {
      toastStore.show({
        message: `Could not update the avatar — try again. (${(e as Error).message})`,
        tone: 'warn',
        durationMs: 3500,
      });
    } finally {
      setPendingAvatar(null);
    }
  }

  function onRemoveAvatar(): void {
    if (!id) return;
    setPendingAvatar('remove');
    void removeAvatarMut
      .mutateAsync(id)
      .catch((e) => {
        toastStore.show({
          message: `Could not update the avatar — try again. (${(e as Error).message})`,
          tone: 'warn',
          durationMs: 3500,
        });
      })
      .finally(() => setPendingAvatar(null));
  }

  // ── Import handler (always-save, writes immediately) ───────────────────────

  async function applyImportedAvatar(
    avatar: NonNullable<AppliedPersonaImport['avatar']>,
  ): Promise<void> {
    if (!id) return;
    const file = new File([avatar.bytes as BlobPart], 'avatar', { type: avatar.mime });
    const n = await normaliseAvatar(file);
    const pendingAv: PendingAvatar = {
      blob: n.blob,
      mime: n.mime,
      width: n.width,
      height: n.height,
      crop: avatar.crop,
    };
    setPendingAvatar(pendingAv);
    try {
      await setAvatarMut.mutateAsync({ personaId: id, ...pendingAv });
    } finally {
      setPendingAvatar(null);
    }
  }

  async function onApplyImport(a: AppliedPersonaImport): Promise<void> {
    // TypeScript does not narrow closed-over variables through async closures;
    // guard explicitly even though persona is PersonaRow by this point.
    if (!id || !persona) return;

    try {
      // Persist persona config immediately — NSFW only ever upgrades (spec §5.3).
      await patch({
        adultPersona: resolveImportedNsfw(persona.adultPersona, a.persona.nsfw),
        ...(a.overwriteConfig
          ? {
              name: a.persona.name,
              tagline: a.persona.tagline,
              instructions: a.persona.instructions,
            }
          : {}),
      });

      if (a.avatar) {
        await applyImportedAvatar(a.avatar).catch((e) => {
          toastStore.show({
            message: `Could not import the avatar — use Change avatar to set one. (${(e as Error).message})`,
            tone: 'warn',
            durationMs: 3500,
          });
        });
      }

      if (a.sessions.length > 0) {
        const res = await importChatsuneSessions(id, a.sessions);
        toastStore.show({
          message:
            res.imported > 0
              ? `Imported ${res.imported} ${res.imported === 1 ? 'chat' : 'chats'}${
                  res.skipped > 0 ? ` (${res.skipped} already imported)` : ''
                }.`
              : 'No new chats to import.',
          tone: 'info',
          durationMs: 3500,
        });
        await qc.invalidateQueries({ queryKey: QK.chats });
      }

      if (a.memory) {
        const m = await importChatsuneMemory(id, a.memory);
        if (m.importedEntries > 0 || m.importedBodies > 0) {
          toastStore.show({
            message: `Imported ${m.importedEntries} ${m.importedEntries === 1 ? 'memory' : 'memories'}${
              m.importedBodies > 0 ? ' and the consolidated memory' : ''
            }.`,
            tone: 'info',
            durationMs: 3500,
          });
        }
        await qc.invalidateQueries({ queryKey: QK.memory(id) });
      }
    } catch (e) {
      toastStore.show({ message: (e as Error).message, tone: 'warn', durationMs: 3500 });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageScaffold
      crumbs={[{ label: 'My Circle', to: returnPath }, { label: persona.name || 'Persona' }]}
      back={returnPath}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div data-testid="persona-hub" className="flex flex-col gap-4 px-4 pb-8 pt-4">
        {/* Offline notice: persona edits are Class-2 writes paused while the
            server is unreachable (spec §11.2). Edits no-op until reconnection;
            the ambient connectivity badge carries the system-level framing. */}
        {editDisabled ? (
          <p
            data-testid="persona-edit-offline-note"
            className="rounded-md border border-paper-soft/20 bg-paper-soft/5 px-3 py-2 text-xs text-paper-soft/80"
          >
            {editTooltip ?? 'Editing is paused while your server is unreachable.'}
          </p>
        ) : null}

        {/* Post-import note — rendered once when landing here from a Chatsundere pack import. */}
        {justImported ? (
          <PostImportNote
            modelBound={justImported.modelBound}
            droppedBindings={justImported.droppedBindings}
          />
        ) : null}

        {/* A. Action row ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            priority={continueGold}
            disabled={!recentChat || incomplete}
            title={
              incomplete
                ? 'Finish setting up the persona first'
                : !recentChat
                  ? 'No chat with this persona yet — start a New Chat'
                  : undefined
            }
            onClick={() => {
              if (recentChat) navigate(`/app/chat/${recentChat.id}`);
            }}
          >
            Continue
          </Button>
          <Button
            priority={newChatGold}
            disabled={incomplete}
            title={incomplete ? 'Finish setting up the persona first' : undefined}
            onClick={() => navigate(`/app/chat/new?personaId=${id}`)}
          >
            New Chat
          </Button>
          <Button disabled title="Coming soon — a chat that leaves nothing in memory">
            New Incognito
          </Button>
          <Button
            disabled={!recentChat}
            title={!recentChat ? 'No chats with this persona yet' : undefined}
            onClick={() => {
              if (id) navigate(`/app/history?personaId=${id}`);
            }}
          >
            History
          </Button>
        </div>

        {/* Incomplete persona cue — shown instead of gold on any button */}
        {incomplete ? (
          <p className="text-[11px] text-paper-soft">
            Add an instruction and pick a model, then {persona.name || 'this persona'} can chat.
          </p>
        ) : null}

        {/* B. Identity hero ───────────────────────────────────────────────── */}
        <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
          {/* Styled display name + tagline next to the avatar */}
          <div className="mb-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-base leading-snug"
                style={{ fontFamily: FONT_VAR[persona.font], color: persona.colour }}
              >
                {persona.name || 'Unnamed'}
              </p>
              {persona.tagline ? (
                <p className="truncate text-[11px] text-paper-soft">{persona.tagline}</p>
              ) : null}
            </div>
          </div>

          <div className="mb-1 text-xs uppercase tracking-widest text-paper-soft">Avatar</div>
          <AvatarField
            personaId={id ?? null}
            name={persona.name || 'Persona'}
            colour={persona.colour}
            pending={pendingAvatar}
            onPick={(f) => void onPickAvatar(f)}
            onRemove={onRemoveAvatar}
          />

          <div className="flex flex-col gap-3">
            <InlineEditRow
              label="Name"
              value={persona.name}
              validate={(v) => (v.trim() === '' ? 'Name is required' : null)}
              onSave={(v) => patch({ name: v })}
            />
            <InlineEditRow
              label="Tagline"
              value={persona.tagline}
              onSave={(v) => patch({ tagline: v })}
            />

            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-paper-soft">Model</span>
                {missingRequirement(persona) === 'model' ? (
                  <span className="text-[11px] text-paper-soft/70">— Needs setup</span>
                ) : null}
              </div>
              <ModelSlotPicker
                label="Model"
                emptyLabel="Choose a model"
                filter="all"
                providers={providers.data ?? []}
                configuredTemplateIds={usableTemplateIds(providers.data ?? [], hasProxy)}
                current={currentModel}
                onSelect={(sel) =>
                  void patch({
                    canonicalId: sel.canonicalId,
                    providerId: sel.providerRowId,
                    modelId: sel.upstreamSlug,
                  })
                }
              />
            </div>
          </div>
        </section>

        {/* C. 8 NavTiles — 2-col grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <NavTile
            colour="pink"
            icon={ScrollText}
            label="Instructions"
            to={`/app/persona/${id}/instructions`}
            meta={instructionsMeta(persona)}
          />
          <NavTile
            colour="pink"
            icon={Drama}
            label="Roleplay"
            to={`/app/persona/${id}/roleplay`}
            meta={roleplayMeta(persona)}
          />
          <NavTile
            colour="blue"
            icon={SlidersHorizontal}
            label="Model behaviour"
            to={`/app/persona/${id}/model`}
            meta={modelBehaviourMeta(persona)}
          />
          <NavTile
            colour="blue"
            icon={Plug}
            label="Integrations"
            to={`/app/persona/${id}/integrations`}
            meta={integrationsMeta(persona)}
          />
          <NavTile
            colour="green"
            icon={BookOpen}
            label="Knowledge"
            to={`/app/persona/${id}/knowledge`}
            meta={knowledgeMeta(persona)}
          />
          <NavTile
            colour="green"
            icon={Brain}
            label="Memory"
            to={`/app/persona/${id}/memory`}
            meta={memoryMeta(persona)}
          />
          <NavTile
            colour="purple"
            icon={Type}
            label="Font & Voice"
            to={`/app/persona/${id}/font-voice`}
            meta={fontVoiceMeta(persona)}
          />
          <NavTile
            colour="purple"
            icon={Sparkles}
            label="Mindspace"
            to={`/app/persona/${id}/mindspace`}
            meta={mindspaceMeta(persona, mindspaces.data ?? [])}
          />
        </div>

        {/* D. Bottom zone — import + export ───────────────────────────────── */}
        <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
          <header className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Import</header>
          <p className="mb-2 text-[11px] text-paper-soft">
            Bring in a Chatsune persona export, blending it into this persona.
          </p>
          <ChatsuneImportControl
            mode="edit"
            personaId={id ?? null}
            existingNsfw={persona.adultPersona}
            onApply={(a) => void onApplyImport(a)}
          />
        </section>

        <Button onClick={() => setShowExportOverlay(true)}>Export persona</Button>
      </div>

      {cropState ? (
        <AvatarCropModal
          imageUrl={cropState.url}
          naturalWidth={cropState.width}
          naturalHeight={cropState.height}
          initialCrop={{ x: 0, y: 0, zoom: 1 }}
          onCancel={() => {
            URL.revokeObjectURL(cropState.url);
            setCropState(null);
          }}
          onConfirm={(crop) => void confirmCrop(crop)}
        />
      ) : null}

      {/* Export overlay — rendered inline so it overlays the whole hub. */}
      {showExportOverlay && id ? (
        <ExportOverlay
          personaId={id}
          personaName={persona.name || 'Persona'}
          onClose={() => setShowExportOverlay(false)}
        />
      ) : null}
    </PageScaffold>
  );
}
