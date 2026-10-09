// SPDX-License-Identifier: AGPL-3.0-only

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { toastStore } from '../../../state/toast.store.js';
import { PURGE_FAILED } from '../../../trash/delete-toast.js';
import { describeRestoreError } from '../../../trash/restore-error.js';
import type { TrashEntityKind } from '../../../trash/trash-model.js';
import {
  type TrashCard,
  listTrashCards,
  purgeCard,
  restoreCard,
} from '../../../trash/trash-repo.js';

const TRASH_CARDS_KEY = ['trash-cards'] as const;

const DAY_MS = 86_400_000;

/** Human noun for an entity kind, used in the purge-confirm body. */
const ENTITY_NOUN: Record<TrashEntityKind, string> = {
  persona: 'persona',
  chat: 'chat',
  memory: 'memory',
  library: 'library',
  document: 'document',
  chatChild: 'item',
  project: 'project',
  projectFile: 'file',
  projectFolder: 'folder',
};

/** Pluralise a labelled count the plain British way ("1 chat" / "2 chats"). */
function plural(n: number, singular: string): string {
  const word = n === 1 ? singular : singular === 'memory' ? 'memories' : `${singular}s`;
  return `${n} ${word}`;
}

/**
 * The named cascade sub-counts (chats, memories, documents), omitting zeroes.
 * Empty when a card carries no typed descendants.
 */
function cascadeParts(counts: TrashCard['counts']): string[] {
  const parts: string[] = [];
  if (counts.chats) parts.push(plural(counts.chats, 'chat'));
  if (counts.memories) parts.push(plural(counts.memories, 'memory'));
  if (counts.documents) parts.push(plural(counts.documents, 'document'));
  return parts;
}

/** Join a list into prose: "a", "a and b", "a, b and c". */
function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  const head = parts.slice(0, -1).join(', ');
  const tail = parts[parts.length - 1] ?? '';
  return `${head} and ${tail}`;
}

/**
 * The count summary shown under a card: the file count for project cards, else
 * the named sub-counts, or a bare "N items" fallback when there are no typed
 * descendants.
 */
function countSummary(counts: TrashCard['counts']): string {
  if (counts.files !== undefined) {
    const earlier = counts.earlierFiles
      ? ` · includes ${plural(counts.earlierFiles, 'file')} deleted earlier`
      : '';
    return `${plural(counts.files, 'file')}${earlier}`;
  }
  const parts = cascadeParts(counts);
  if (parts.length > 0) return parts.join(' · ');
  return plural(counts.items, 'item');
}

/** The line under a card's title: a file card names its project, others summarise counts. */
function cardSummary(card: TrashCard): string {
  if (card.entityKind === 'projectFile' && card.projectName !== undefined) return card.projectName;
  return countSummary(card.counts);
}

/** A calm, day-granular "deleted X ago" label suited to the 30-day window. */
function deletedAgoLabel(deletedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - deletedAt);
  const days = Math.floor(diff / DAY_MS);
  if (days < 1) return 'deleted today';
  if (days === 1) return 'deleted yesterday';
  return `deleted ${days} days ago`;
}

/** The purge-confirm body, naming the entity and its concrete cascade. */
function purgeBody(card: TrashCard): string {
  const noun = ENTITY_NOUN[card.entityKind];
  const files = card.counts.files;
  if ((card.entityKind === 'projectFolder' || card.entityKind === 'project') && files) {
    return `Permanently delete this ${noun} and its ${plural(files, 'file')}? This cannot be undone.`;
  }
  const parts = cascadeParts(card.counts);
  const tail = parts.length > 0 ? ` and its ${joinWithAnd(parts)}` : '';
  return `Permanently delete this ${noun}${tail}? This cannot be undone.`;
}

/**
 * Recently deleted — the trashcan surface (spec §3.8).
 *
 * Lists deleted items as grouped restore-unit cards. Each card can be restored
 * (as a fresh copy) or purged now; both mutations refresh the list. Untouched
 * items are swept after 30 days.
 */
export function RecentlyDeletedPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('recently-deleted');
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<TrashCard | null>(null);

  const cards = useQuery({
    queryKey: TRASH_CARDS_KEY,
    queryFn: () => listTrashCards(),
  });

  const restore = useMutation({
    mutationFn: (cardKey: string) => restoreCard(cardKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TRASH_CARDS_KEY });
      toastStore.show({ message: 'Restored.', tone: 'success', durationMs: 2500 });
    },
    onError: (e) => {
      toastStore.show({
        message: describeRestoreError(e) ?? 'Could not restore. Please try again.',
        tone: 'warn',
        durationMs: 8000,
      });
    },
  });

  const purge = useMutation({
    mutationFn: (cardKey: string) => purgeCard(cardKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TRASH_CARDS_KEY });
      toastStore.show({ message: 'Deleted.', tone: 'success', durationMs: 2500 });
    },
    onError: (e) => {
      console.warn('Permanent delete failed', e);
      toastStore.show({ message: PURGE_FAILED, tone: 'warn', durationMs: 8000 });
    },
  });

  const list = cards.data ?? [];

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Recently deleted' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-4 px-4 pb-8 pt-2">
        {cards.isSuccess && list.length === 0 ? (
          <p className="text-sm text-paper-soft">
            {"Nothing here — deleted items rest here for 30 days before they're gone."}
          </p>
        ) : (
          list.map((card) => (
            <div
              key={card.cardKey}
              className="space-y-3 rounded-[var(--radius-card)] bg-ink-soft p-4 ring-1 ring-inset ring-aurora-700/30"
            >
              <div className="space-y-1">
                <p className="font-display text-base text-paper">{card.title}</p>
                <p className="text-xs text-paper-soft">
                  {cardSummary(card)} · {deletedAgoLabel(card.deletedAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  tone="primary"
                  priority
                  onClick={() => restore.mutate(card.cardKey)}
                  disabled={restore.isPending}
                  className="flex-1"
                >
                  Restore
                </Button>
                <Button
                  tone="destructive"
                  onClick={() => setConfirming(card)}
                  disabled={purge.isPending}
                  className="flex-1"
                >
                  Delete now
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title="Delete permanently?"
        body={confirming !== null ? purgeBody(confirming) : undefined}
        confirmLabel="Delete now"
        cancelLabel="Keep it"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const card = confirming;
          setConfirming(null);
          if (card !== null) purge.mutate(card.cardKey);
        }}
      />
    </PageScaffold>
  );
}
