// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ArtefactRow, type PillRow, getClientDataDb } from '../../../boot/client-data-db.js';
import { findMediaArtefactByKey, patchMediaPillItem } from '../../../data/media-artefacts.js';
import { QK } from '../../../data/queryKeys.js';
import { triggerDownload } from '../../../lib/download.js';
import {
  type MediaSaveOutcome,
  awaitInFlightSave,
  isExpired,
  progressKey,
  saveMedia,
} from '../../../lib/media/media-save.js';
import { queryClient } from '../../../lib/queryClient.js';
import { prefersReducedMotion } from '../../../lib/reduced-motion.js';
import type { MediaItem } from '../../../mcp/media-items.js';
import { useMediaProgress } from '../../../state/media-progress.store.js';
import { useBlobBytes } from '../../../sync/blob-fetch.js';
import { syncCopy } from '../../../sync/copy.js';
import { BlobSyncMarker } from '../../blob/BlobSyncMarker.js';
import { AudioRow } from './AudioRow.js';
import { MediaMenu } from './MediaMenu.js';
import { VideoTile } from './VideoTile.js';
import { mediaCopy } from './media-copy.js';

const GLYPH = { audio: '♪', video: '▶' } as const;

/**
 * A playable audio or video artefact, wherever it is shown: the chat card, the Treasury, the
 * lightbox. Bytes not yet on this device are fetched from the vault; bytes that never reached
 * it leave the player greyed out with the reason, title and duration still shown.
 */
export function MediaPlayer({
  artefact,
  title,
  compact = false,
  menu: withMenu = true,
  onOpenInTreasury,
}: {
  artefact: ArtefactRow;
  title: string;
  compact?: boolean;
  /** False where the surrounding surface already offers Download (the lightbox toolbar). */
  menu?: boolean;
  onOpenInTreasury?: () => void;
}): JSX.Element {
  const fetched = useBlobBytes('artefacts', artefact.id, 'blob');
  const local = artefact.blob && artefact.blob.size > 0 ? artefact.blob : null;
  const bytes = local ?? (fetched.state === 'ready' ? (fetched.bytes ?? null) : null);
  const unavailable =
    bytes !== null
      ? null
      : fetched.state === 'terminal'
        ? mediaCopy.deviceOnly
        : mediaCopy.downloading;
  const retry = bytes === null ? fetched.retry : undefined;

  const menu = withMenu ? (
    <MediaMenu
      title={title}
      downloadDisabledReason={unavailable}
      onDownload={() => {
        if (bytes) triggerDownload(bytes, artefact.fileName);
      }}
      {...(onOpenInTreasury ? { onOpenInTreasury } : {})}
    />
  ) : null;
  const note = (
    <>
      {unavailable !== null ? (
        <span className="media-note">
          {unavailable}
          {retry ? (
            <button type="button" className="media-note-action" onClick={() => retry()}>
              {syncCopy.actions.retry}
            </button>
          ) : null}
        </span>
      ) : null}
      {bytes !== null ? (
        <BlobSyncMarker
          oversized={artefact.blobOversized === true}
          hasUnsyncedBlob={artefact.blob !== undefined && artefact.blobRef === undefined}
        />
      ) : null}
    </>
  );

  return (
    <div
      className="media-player"
      data-media-artefact={artefact.id}
      data-kind={artefact.kind}
      data-compact={compact || undefined}
    >
      {artefact.kind === 'video' ? (
        <VideoTile
          artefact={artefact}
          title={title}
          blob={bytes}
          unavailable={unavailable}
          menu={menu}
          note={note}
        />
      ) : (
        <AudioRow
          artefactId={artefact.id}
          title={title}
          blob={bytes}
          knownDurationMs={artefact.mediaMeta?.durationMs ?? null}
          unavailable={unavailable}
          menu={menu}
          note={note}
        />
      )}
    </div>
  );
}

function SavedItem({
  item,
  onOpenInTreasury,
}: {
  item: MediaItem & { artefactId: string };
  onOpenInTreasury: (artefactId: string) => void;
}): JSX.Element | null {
  const { data: artefact } = useQuery({
    // Under the 'artefacts' prefix, so rename, delete and blob hydration refresh it too.
    queryKey: ['artefacts', 'media-card', item.artefactId],
    queryFn: async () => (await getClientDataDb().artefacts.get(item.artefactId)) ?? null,
    // No focus refetch under a playing file; invalidation (rename, delete) still refetches.
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (artefact === undefined) return <SettlingRow item={item} />;
  // A file deleted from the Treasury leaves nothing behind, as for generated images.
  if (artefact === null) return null;
  return (
    <MediaPlayer
      artefact={artefact}
      title={item.title}
      onOpenInTreasury={() => onOpenInTreasury(artefact.id)}
    />
  );
}

function SettlingRow({ item }: { item: MediaItem }): JSX.Element {
  return (
    // The artefact id lets a later card's duplicate marker find this one while it settles.
    <div className="media-state" data-state="settling" data-media-artefact={item.artefactId}>
      <span className="media-state-glyph" aria-hidden>
        {GLYPH[item.kind]}
      </span>
      <span className="media-title">{item.title}</span>
    </div>
  );
}

function SavingRow({ item, chatId }: { item: MediaItem; chatId: string | null }): JSX.Element {
  const progress = useMediaProgress((s) =>
    chatId !== null ? s.byKey[progressKey(chatId, item.key)] : undefined,
  );
  const fraction =
    progress && progress.total !== null && progress.total > 0
      ? Math.min(1, progress.done / progress.total)
      : null;
  return (
    <div className="media-state" data-state="saving" data-media-artefact={item.artefactId}>
      <div className="media-state-line">
        <span className="media-state-glyph" aria-hidden>
          {GLYPH[item.kind]}
        </span>
        <span className="media-title">{item.title}</span>
      </div>
      <output className="media-state-text">{mediaCopy.saving(item.kind, progress)}</output>
      <span className="media-state-bar" data-indeterminate={fraction === null || undefined}>
        <i style={fraction !== null ? { width: `${Math.round(fraction * 100)}%` } : undefined} />
      </span>
    </div>
  );
}

function FailedRow({
  item,
  canSave,
  onRetry,
}: {
  item: MediaItem;
  canSave: boolean;
  onRetry: () => void;
}): JSX.Element {
  const causeId = useId();
  const reasonId = useId();
  const source = item.source;
  const expired = source ? isExpired(source) : false;
  const cause = expired ? 'expired' : (item.cause ?? 'unreachable');
  const reason = expired ? mediaCopy.linkExpired : null;
  // Expired and too-large say why in the cause line already; only "cannot save" needs its own.
  const causeExplains = cause === 'expired' || cause === 'too-large';
  const retryDisabled = causeExplains || !canSave;
  const retryReasonId = causeExplains ? causeId : retryDisabled ? reasonId : undefined;
  return (
    <div className="media-state" data-state="failed">
      <div className="media-state-line">
        <span className="media-state-glyph" aria-hidden>
          {GLYPH[item.kind]}
        </span>
        <span className="media-title">{item.title}</span>
      </div>
      <span className="media-state-text" id={causeId}>
        {mediaCopy.failed[cause]}
      </span>
      {source ? (
        <>
          <span className="media-state-actions">
            <button
              type="button"
              className="media-action"
              aria-disabled={retryDisabled ? 'true' : undefined}
              aria-describedby={retryReasonId}
              title={reason ?? undefined}
              onClick={() => {
                if (!retryDisabled) onRetry();
              }}
            >
              {mediaCopy.tryAgain}
            </button>
            <button
              type="button"
              className="media-action"
              aria-disabled={expired ? 'true' : undefined}
              aria-describedby={expired ? causeId : undefined}
              title={reason ?? undefined}
              onClick={() => {
                if (expired || !source.url.startsWith('https://')) return;
                window.open(source.url, '_blank', 'noopener,noreferrer');
              }}
            >
              {mediaCopy.openOriginal}
            </button>
          </span>
          {retryDisabled && !causeExplains ? (
            <span className="media-state-reason" id={reasonId}>
              {mediaCopy.cannotFetchAgain}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function findEarlierPlayer(ids: readonly (string | undefined)[]): HTMLElement | null {
  for (const id of ids) {
    if (!id) continue;
    const el = document.querySelector<HTMLElement>(`[data-media-artefact="${CSS.escape(id)}"]`);
    if (el) return el;
  }
  return null;
}

/**
 * One marker for the files the chat already shows. The earlier players load on their own
 * schedule (or were deleted), so their presence is watched rather than read once.
 */
function DuplicateMarker({ ids }: { ids: (string | undefined)[] }): JSX.Element {
  const sig = ids.join('|');
  const [present, setPresent] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids' signature
  useEffect(() => {
    const check = (): void => setPresent(findEarlierPlayer(ids) !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [sig]);
  const reasonId = useId();
  return (
    <>
      <button
        type="button"
        className="media-card-duplicate"
        aria-disabled={present ? undefined : 'true'}
        aria-describedby={present ? undefined : reasonId}
        title={present ? undefined : mediaCopy.duplicatesGone}
        onClick={() => {
          findEarlierPlayer(ids)?.scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'center',
          });
        }}
      >
        {mediaCopy.duplicates(ids.length)}
      </button>
      {present ? null : (
        <span className="media-card-note" id={reasonId}>
          {mediaCopy.duplicatesGone}
        </span>
      )}
    </>
  );
}

/**
 * The block under an MCP tool pill that carries audio or video: the provider label, one
 * player per saved file, the saving and failed states, and a single marker for files the
 * chat already shows. Saves left running after the tool returned are joined and settled here.
 */
export function MediaCard({
  pill,
  chatId,
  personaId,
  serverLabel,
  toolName,
}: {
  pill: PillRow;
  chatId: string | null;
  personaId: string | null;
  serverLabel: string;
  toolName?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const payload = pill.payload as { media?: unknown; mediaRefused?: unknown } | undefined;
  const stored = (payload?.media ?? []) as MediaItem[];
  // A result whose files were all refused has no item to carry the count.
  const refusedAlone = typeof payload?.mediaRefused === 'number' ? payload.mediaRefused : 0;
  // The pill row re-reads only when its chat query refetches, so a settled item shows at once.
  const [overrides, setOverrides] = useState<Record<string, Partial<MediaItem>>>({});
  const items = stored.map((item) => ({ ...item, ...overrides[item.key] }));
  const started = useRef(new Set<string>());

  const settle = async (key: string, patch: Partial<MediaItem>): Promise<void> => {
    setOverrides((o) => ({ ...o, [key]: { ...o[key], ...patch } }));
    await patchMediaPillItem(pill.id, key, patch).catch(() => false);
    if (chatId !== null) void queryClient.invalidateQueries({ queryKey: QK.chat(chatId) });
  };

  const save = async (item: MediaItem): Promise<void> => {
    if (!item.source || chatId === null || personaId === null) return;
    setOverrides((o) => ({ ...o, [item.key]: { ...o[item.key], status: 'saving' } }));
    const outcome: MediaSaveOutcome = await saveMedia(
      {
        key: item.key,
        kind: item.kind,
        mime: item.mime,
        source: { kind: 'url', url: item.source.url },
        expiresAt: item.source.expiresAt,
        providerName: null,
      },
      { chatId, personaId, serverName: serverLabel, toolName: toolName ?? '', title: item.title },
    ).catch((): MediaSaveOutcome => ({ status: 'failed', cause: 'unreachable' }));
    await settleFrom(item.key, outcome);
  };

  const settleFrom = (key: string, outcome: MediaSaveOutcome): Promise<void> =>
    // A duplicate of this card's own key is its own earlier save finishing, not a repeat.
    outcome.status === 'failed'
      ? settle(key, { status: 'failed', cause: outcome.cause })
      : settle(key, { status: 'saved', artefactId: outcome.artefactId });

  // Inline bytes cannot be fetched again: join the tool's save if it still runs, else find
  // the finished one by its key, else nothing will ever arrive and the item has failed.
  const settleInline = async (key: string, chat: string): Promise<void> => {
    const running = awaitInFlightSave(chat, key);
    if (running) {
      const outcome = await running.catch(
        (): MediaSaveOutcome => ({ status: 'failed', cause: 'unreachable' }),
      );
      await settleFrom(key, outcome);
      return;
    }
    let row: ArtefactRow | undefined;
    try {
      row = await findMediaArtefactByKey(chat, key);
    } catch {
      return; // An unreadable store says nothing about the file; leave it for the next look.
    }
    if (row) await settle(key, { status: 'saved', artefactId: row.id });
    else await settle(key, { status: 'failed', cause: 'unreachable' });
  };

  const storedSig = stored.map((i) => `${i.key}:${i.status}`).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the items' status signature, not the payload identity
  useEffect(() => {
    for (const item of stored) {
      if (item.status !== 'saving' || started.current.has(item.key)) continue;
      started.current.add(item.key);
      if (!item.source) {
        if (chatId === null) continue;
        void settleInline(item.key, chatId);
      } else if (isExpired(item.source)) {
        void settle(item.key, { status: 'failed', cause: 'expired' });
      } else {
        void save(item);
      }
    }
  }, [storedSig, chatId, personaId]);

  const openInTreasury = (artefactId: string): void =>
    navigate(`/app/treasury?type=media&open=${encodeURIComponent(artefactId)}`);
  const duplicates = items.filter((i) => i.status === 'duplicate');
  const shown = items.filter((i) => i.status !== 'duplicate');
  const refused = items[0]?.refused ?? refusedAlone;

  return (
    <div className="media-card">
      <span className="media-card-provider">{mediaCopy.provider(serverLabel, toolName)}</span>
      {shown.length > 0 ? (
        <div className="media-card-items">
          {shown.map((item) => {
            if (item.status === 'saved' && item.artefactId) {
              return (
                <SavedItem
                  key={item.key}
                  item={{ ...item, artefactId: item.artefactId }}
                  onOpenInTreasury={openInTreasury}
                />
              );
            }
            if (item.status === 'failed') {
              return (
                <FailedRow
                  key={item.key}
                  item={item}
                  canSave={chatId !== null && personaId !== null}
                  onRetry={() => void save(item)}
                />
              );
            }
            return <SavingRow key={item.key} item={item} chatId={chatId} />;
          })}
        </div>
      ) : null}
      {duplicates.length > 0 ? <DuplicateMarker ids={duplicates.map((d) => d.artefactId)} /> : null}
      {refused > 0 ? <span className="media-card-note">{mediaCopy.refused(refused)}</span> : null}
    </div>
  );
}
