// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AvatarCropModal } from '../../../components/AvatarCropModal.js';
import { ModelSlotPicker } from '../../../components/ModelSlotPicker.js';
import { AvatarField, type PendingAvatar } from '../../../components/persona-editor/AvatarField.js';
import {
  type AppliedPersonaImport,
  ChatsuneImportControl,
} from '../../../components/persona-editor/ChatsuneImportControl.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { importChatsuneMemory, importChatsuneSessions } from '../../../data/chatsune-import.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useRemovePersonaAvatar, useSetPersonaAvatar } from '../../../data/persona-avatars.js';
import { useCreatePersona } from '../../../data/personas.js';
import { useProviders } from '../../../data/providers.js';
import { QK } from '../../../data/queryKeys.js';
import { useSettings } from '../../../data/settings.js';
import { normaliseAvatar } from '../../../lib/avatar-normalise.js';
import { resolveImportedNsfw } from '../../../lib/chatsune-import/nsfw.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';
import { toastStore } from '../../../state/toast.store.js';
import { type DraftPersona, defaultDraft } from './persona-draft.js';

/** Route component: focused one-step persona creation form. */
export function PersonaCreate(): JSX.Element {
  const navigate = useNavigate();
  const { onHelp, helpOverlay } = useHelp('persona');

  const settings = useSettings();
  const mindspaces = useMindspaces();
  const providers = useProviders();
  const qc = useQueryClient();
  const create = useCreatePersona();
  const setAvatarMut = useSetPersonaAvatar();
  const removeAvatarMut = useRemovePersonaAvatar();

  const [draft, setDraft] = useState<DraftPersona>(() =>
    defaultDraft(settings.data, mindspaces.data, providers.data),
  );
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar>(null);
  // Guards the one-shot create sequence against double-submit. Stays true on the
  // success path (we navigate away); reset to false only if the sequence throws.
  const [isBusy, setIsBusy] = useState(false);

  // Sessions and memory staged from a Chatsune import; written after the persona
  // row exists. Cleared immediately after write.
  const [importedSessions, setImportedSessions] = useState<AppliedPersonaImport['sessions']>([]);
  const [importedMemory, setImportedMemory] = useState<AppliedPersonaImport['memory']>(null);
  const [stagedChatCount, setStagedChatCount] = useState(0);

  const [cropState, setCropState] = useState<{
    url: string;
    width: number;
    height: number;
    blob: Blob;
    mime: string;
  } | null>(null);

  async function applyImportedAvatar(avatar: NonNullable<AppliedPersonaImport['avatar']>) {
    // Re-normalise the chatsune avatar bytes through our pipeline (→ WebP ≤512 px);
    // the crop is already converted to our fractional model.
    const file = new File([avatar.bytes as BlobPart], 'avatar', { type: avatar.mime });
    const n = await normaliseAvatar(file);
    setPendingAvatar({
      blob: n.blob,
      mime: n.mime,
      width: n.width,
      height: n.height,
      crop: avatar.crop,
    });
  }

  function onApplyImport(a: AppliedPersonaImport) {
    setDraft((d) => ({
      ...d,
      // NSFW only ever upgrades, independent of the overwrite choice (spec §5.3).
      adultPersona: resolveImportedNsfw(d.adultPersona, a.persona.nsfw),
      ...(a.overwriteConfig
        ? {
            name: a.persona.name,
            tagline: a.persona.tagline,
            instructions: a.persona.instructions,
          }
        : {}),
    }));
    if (a.avatar) {
      void applyImportedAvatar(a.avatar).catch((e) => {
        toastStore.show({
          message: `Could not import the avatar — use Change avatar to set one. (${(e as Error).message})`,
          tone: 'warn',
          durationMs: 3500,
        });
      });
    }
    setImportedSessions(a.sessions);
    setImportedMemory(a.memory);
    setStagedChatCount(a.newChatCount);
  }

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

  async function onCreate() {
    // One-shot, hard-to-undo action: ignore re-entry and lock the button while
    // the create-then-stage sequence runs.
    if (isBusy) return;
    setIsBusy(true);
    try {
      const row = await create.mutateAsync(draft);
      const pid = row.id;

      if (pendingAvatar) {
        if (pendingAvatar === 'remove') {
          await removeAvatarMut.mutateAsync(pid);
        } else {
          await setAvatarMut.mutateAsync({ personaId: pid, ...pendingAvatar });
        }
        setPendingAvatar(null);
      }

      if (importedSessions.length > 0) {
        const res = await importChatsuneSessions(pid, importedSessions);
        setImportedSessions([]);
        setStagedChatCount(0);
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

      if (importedMemory) {
        const m = await importChatsuneMemory(pid, importedMemory);
        setImportedMemory(null);
        if (m.importedEntries > 0 || m.importedBodies > 0) {
          toastStore.show({
            message: `Imported ${m.importedEntries} ${m.importedEntries === 1 ? 'memory' : 'memories'}${
              m.importedBodies > 0 ? ' and the consolidated memory' : ''
            }.`,
            tone: 'info',
            durationMs: 3500,
          });
        }
        await qc.invalidateQueries({ queryKey: QK.memory(pid) });
      }

      // Success: navigate away without resetting isBusy (the page unmounts).
      navigate(`/app/persona/${pid}`);
    } catch (e) {
      setIsBusy(false);
      toastStore.show({ message: (e as Error).message, tone: 'warn', durationMs: 3500 });
    }
  }

  const canCreate = draft.name.trim().length > 0;
  const providerRow = providers.data?.find((p) => p.id === draft.providerId);
  const currentModel =
    providerRow && draft.modelId
      ? { providerTemplateId: providerRow.templateId, upstreamSlug: draft.modelId }
      : null;

  return (
    <PageScaffold
      crumbs={[{ label: 'My Circle', to: '/app/circle' }, { label: 'New persona' }]}
      back="/app/circle"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-4">
        {/* ── Import from Chatsune ─────────────────────────────────────────── */}
        <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
          <header className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Import</header>
          <p className="mb-2 text-[11px] text-paper-soft">
            Coming from Chatsune? Import a persona and its chats.
          </p>
          <ChatsuneImportControl
            mode="create"
            personaId={null}
            existingNsfw={draft.adultPersona}
            onApply={onApplyImport}
          />
          {stagedChatCount > 0 ? (
            <p className="mt-2 text-[11px] text-paper-soft">
              {stagedChatCount} {stagedChatCount === 1 ? 'chat' : 'chats'} ready — Create to bring
              them in.
            </p>
          ) : null}
        </section>

        {/* ── Identity ─────────────────────────────────────────────────────── */}
        <section className="rounded-card border border-white/5 bg-white/[0.02] p-3">
          <header className="mb-2 text-xs uppercase tracking-widest text-paper-soft">
            Identity
          </header>

          <div className="mb-2 text-xs uppercase tracking-widest text-paper-soft">Avatar</div>
          <AvatarField
            personaId={null}
            name={draft.name || 'New Persona'}
            colour={draft.colour}
            pending={pendingAvatar}
            onPick={(f) => void onPickAvatar(f)}
            onRemove={() => setPendingAvatar('remove')}
          />

          <div className="mb-2 mt-3 flex items-center gap-2">
            <label
              className="text-xs uppercase tracking-widest text-paper-soft"
              htmlFor="persona-name"
            >
              Name
            </label>
            {!draft.name ? (
              <span aria-label="Name is required" className="text-danger" data-required-marker>
                ✕
              </span>
            ) : null}
          </div>
          <input
            id="persona-name"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          />

          <label
            className="mb-2 block text-xs uppercase tracking-widest text-paper-soft"
            htmlFor="persona-tagline"
          >
            Tagline
          </label>
          <input
            id="persona-tagline"
            type="text"
            value={draft.tagline}
            onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
            className="mb-3 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
          />

          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-paper-soft">Model</span>
          </div>
          <ModelSlotPicker
            label="Model"
            emptyLabel="Choose a model"
            filter="all"
            providers={providers.data ?? []}
            configuredTemplateIds={usableTemplateIds(
              providers.data ?? [],
              !!settings.data?.corsProxy,
            )}
            current={currentModel}
            onSelect={(sel) =>
              setDraft((d) => ({
                ...d,
                canonicalId: sel.canonicalId,
                providerId: sel.providerRowId,
                modelId: sel.upstreamSlug,
              }))
            }
          />
        </section>

        {/* ── Create action ────────────────────────────────────────────────── */}
        <Button
          priority
          disabled={!canCreate || isBusy}
          title={!canCreate ? 'Give your persona a name' : undefined}
          onClick={() => void onCreate()}
        >
          Create persona
        </Button>
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
          onConfirm={(crop) => {
            setPendingAvatar({
              blob: cropState.blob,
              mime: cropState.mime,
              width: cropState.width,
              height: cropState.height,
              crop,
            });
            URL.revokeObjectURL(cropState.url);
            setCropState(null);
          }}
        />
      ) : null}
    </PageScaffold>
  );
}
