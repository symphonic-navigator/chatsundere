// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow, DocumentRow, LibraryRow, PersonaRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { computeEffectiveLibraries } from './effective-libraries.js';
import {
  KNOWLEDGE_LORE_OPTS,
  type LoreDocument,
  type LoreResult,
  formatLore,
  selectLore,
} from './lore.js';

/** Injectable I/O so matching is testable without a live db. */
export interface LoreContextDeps {
  listLibraries: () => Promise<LibraryRow[]>;
  listDocumentsInLibraries: (libraryIds: string[]) => Promise<DocumentRow[]>;
}

function liveDeps(): LoreContextDeps {
  const db = getClientDataDb();
  return {
    listLibraries: () => db.libraries.toArray(),
    listDocumentsInLibraries: (ids) => db.documents.where('libraryId').anyOf(ids).toArray(),
  };
}

export interface LoreContext {
  /** Band-2 prompt segment text. */
  loreContext: string;
  /** Pill payload source (entries + omitted/truncated counts). */
  lore: LoreResult;
}

/**
 * Build the per-send lore for a chat: effective-library-scoped (identical to
 * retrieval), phrase-matched, budgeted, formatted. `null` when nothing fired.
 */
export async function buildLoreContext(
  persona: Pick<PersonaRow, 'adultPersona' | 'libraryIds'>,
  chat: Pick<ChatRow, 'libraryIds'>,
  userText: string,
  precedingCompanionText: string | null,
  recentlyInjectedDocumentIds: ReadonlySet<string> = new Set(),
  deps: LoreContextDeps = liveDeps(),
): Promise<LoreContext | null> {
  const all = await deps.listLibraries();
  const effective = computeEffectiveLibraries(
    persona.libraryIds ?? [],
    chat.libraryIds ?? [],
    all,
    persona.adultPersona,
  );
  if (effective.length === 0) return null;

  const rows = await deps.listDocumentsInLibraries(effective.map((l) => l.id));
  const loreDocs: LoreDocument[] = rows.map((d) => ({
    id: d.id,
    libraryId: d.libraryId,
    title: d.title,
    content: d.content,
    triggerPhrases: d.triggerPhrases,
    triggerOnCompanion: d.triggerOnCompanion ?? false,
    createdAt: d.createdAt,
  }));

  const result = selectLore(
    loreDocs,
    effective.map((l) => ({ id: l.id, name: l.name })),
    userText,
    precedingCompanionText,
    KNOWLEDGE_LORE_OPTS,
    recentlyInjectedDocumentIds,
  );
  if (result.entries.length === 0) return null;

  return { loreContext: formatLore(result.entries), lore: result };
}
