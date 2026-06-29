// SPDX-License-Identifier: AGPL-3.0-only

import { CODEC_VERSION, EMBED_DIM, MODEL_ID, decode } from '@chatsundere/embeddings';
import {
  type AttachmentRow,
  type ChatRow,
  type CompactionCheckpointRow,
  type ContentBlock,
  type DocumentRow,
  type LibraryRow,
  type MemoryBodyRow,
  type MemoryJournalRow,
  type MessageRow,
  type PersonaAvatarRow,
  type PersonaRow,
  type PillRow,
  getClientDataDb,
} from '../boot/client-data-db.js';
import { KNOWLEDGE_COLLECTION, getKnowledgeVectorStore } from '../boot/knowledge-vectors-db.js';
import { enqueueDocument } from '../knowledge/start-ingestion.js';
import { IdRemap } from '../lib/chatsundere-transfer/id-remap.js';
import {
  type ExportedVector,
  readKnowledgePack,
} from '../lib/chatsundere-transfer/knowledge-pack.js';
import { readPersonaPack } from '../lib/chatsundere-transfer/persona-pack.js';
import { resolveVectorStrategy } from '../lib/chatsundere-transfer/vector-strategy.js';

/** Result returned by `importPersonaPack`. */
export interface ImportedPersonaResult {
  /** Newly-minted id of the imported persona. */
  personaId: string;
  /** True when the pack's modelRef was resolved to a local provider. */
  modelBound: boolean;
  /**
   * True when the feature could not transfer live bindings (mcpOverrides /
   * libraryIds). Always true — the feature never transfers bindings.
   */
  droppedBindings: boolean;
}

/**
 * Import a Chatsundere persona pack as a brand-new persona.
 *
 * All ids are remapped to fresh uuidv7 values so no collision with existing
 * data is possible. Live bindings (mcpOverrides, libraryIds) are always
 * degraded to empty defaults. The provider is re-resolved from the portable
 * modelRef; if no local provider matches, the persona is imported without a
 * model and the caller must prompt for a re-pick.
 */
export async function importPersonaPack(
  input: Blob,
  targetName: string,
): Promise<ImportedPersonaResult> {
  const { payload } = await readPersonaPack(input);
  const db = getClientDataDb();
  const remap = new IdRemap();

  // Mint a fresh persona id. The sentinel 'persona' is a stable key that will
  // never collide with a real exported entity id (which are uuidv7 hex strings).
  const personaId = remap.fresh('persona');
  const now = Date.now();

  // ── Model resolution ──────────────────────────────────────────────────────
  let resolvedProviderId = '';
  let resolvedModelId = '';
  let modelBound = false;

  const { modelRef } = payload.persona;
  if (modelRef !== null) {
    const providers = await db.providers.toArray();
    const provider = providers.find((p) => p.templateId === modelRef.providerTemplateId);
    if (provider) {
      resolvedProviderId = provider.id;
      resolvedModelId = modelRef.modelId;
      modelBound = true;
    }
  }

  // ── Mindspace resolution ──────────────────────────────────────────────────
  const settings = await db.settings.get(1);
  const defaultMindspaceId = settings?.defaultMindspaceId ?? '';

  let resolvedPersonaMindspaceId: string | null = null;
  if (payload.persona.mindspaceId) {
    const ms = await db.mindspaces.get(payload.persona.mindspaceId);
    resolvedPersonaMindspaceId = ms ? payload.persona.mindspaceId : null;
  }
  // Fallback: if the persona's mindspace is absent locally, use the setting default.
  const fallbackMindspaceId = resolvedPersonaMindspaceId ?? defaultMindspaceId;

  // ── Build the persona row ─────────────────────────────────────────────────
  const { modelRef: _modelRef, ...restPersona } = payload.persona;

  // The explicit cast on mcpOverrides is needed because the test fixture uses
  // `{ 'srv-1': true }` (invalid type) via `as never`; the spread from the
  // ExportedPersona may carry that value at runtime. We overwrite it to `{}`.
  const personaRow: PersonaRow = {
    ...(restPersona as Omit<
      PersonaRow,
      'id' | 'providerId' | 'modelId' | 'mcpOverrides' | 'libraryIds' | 'lastInteractionAt'
    >),
    id: personaId,
    name: targetName,
    providerId: resolvedProviderId,
    modelId: resolvedModelId,
    mcpOverrides: {},
    libraryIds: [],
    mindspaceId: resolvedPersonaMindspaceId,
    updatedAt: now,
    // lastInteractionAt intentionally omitted — treated as undefined (not set yet)
  };

  // ── Write persona ─────────────────────────────────────────────────────────
  await db.personas.add(personaRow);

  // ── Write avatar ──────────────────────────────────────────────────────────
  if (payload.avatar) {
    const avatarRow: PersonaAvatarRow = {
      personaId,
      // Copy into a fresh ArrayBuffer (Uint8Array<ArrayBuffer>) so the Blob
      // constructor receives a BlobPart-compatible typed array.
      blob: new Blob([new Uint8Array(payload.avatar.bytes)], { type: payload.avatar.mime }),
      mime: payload.avatar.mime,
      // Width/height/crop are not carried in the pack; use defaults.
      // The user can correct via the persona settings avatar editor.
      width: 0,
      height: 0,
      crop: { x: 0, y: 0, zoom: 1 },
      updatedAt: now,
    };
    await db.personaAvatars.put(avatarRow);
  }

  // Pre-register message and checkpoint ids before the chat loop. Chat rows
  // carry activeCompactionId and lastExtractedMessageId — cross-table cursors
  // that point at ids from tables written AFTER chats. Pre-registering here
  // ensures the fresh ids exist in the remap when we build each chat row.
  // IdRemap.fresh is idempotent, so the later loops calling it again are safe.
  for (const m of payload.messages) remap.fresh(m.id);
  for (const cp of payload.checkpoints) remap.fresh(cp.id);
  // Pre-register pill ids so message contentBlock pillIds can be remapped (C1).
  for (const pill of payload.pills) remap.fresh(pill.id);
  // Pre-register artefact ids so pill payload artefact refs can be remapped (I1).
  for (const art of payload.artefacts) remap.fresh(art.id);

  // ── Remap and write chats ─────────────────────────────────────────────────
  const chatRows: ChatRow[] = await Promise.all(
    payload.chats.map(async (chat) => {
      const newChatId = remap.fresh(chat.id);
      // Validate resolvedMindspaceId against the local DB; keep it only if the
      // mindspace actually exists on this device. Falls back to the same default
      // used for the persona (fallbackMindspaceId).
      let chatMindspaceId = fallbackMindspaceId;
      const srcMindspaceId = chat.resolvedMindspaceId as string | undefined;
      if (srcMindspaceId) {
        const ms = await db.mindspaces.get(srcMindspaceId);
        chatMindspaceId = ms ? srcMindspaceId : fallbackMindspaceId;
      }
      return {
        ...chat,
        id: newChatId,
        personaId,
        resolvedMindspaceId: chatMindspaceId,
        // Clear chat-level library bindings — they are device-local refs.
        libraryIds: [],
        draftInput: (chat.draftInput as string | undefined) ?? '',
        bookmarkedMessageCount: (chat.bookmarkedMessageCount as number | undefined) ?? 0,
        // Remap cross-table cursor fields. The pre-registration loop above
        // ensures the fresh ids are in the remap before we reach here, so
        // remap.map will always resolve when the source id was non-null.
        activeCompactionId: chat.activeCompactionId
          ? (remap.map(chat.activeCompactionId) ?? null)
          : null,
        lastExtractedMessageId: chat.lastExtractedMessageId
          ? (remap.map(chat.lastExtractedMessageId) ?? null)
          : null,
      };
    }),
  );
  if (chatRows.length > 0) await db.chats.bulkAdd(chatRows);

  // ── Remap and write messages ──────────────────────────────────────────────
  const messageRows: MessageRow[] = payload.messages.map((msg) => {
    // Remap pill references embedded in contentBlocks (C1 fix).
    const blocks = (msg.contentBlocks as ContentBlock[]).map((b) =>
      b.type === 'pill' ? { ...b, pillId: remap.map(b.pillId) ?? b.pillId } : b,
    );
    return {
      ...msg,
      id: remap.fresh(msg.id),
      chatId: remap.map(msg.chatId) ?? msg.chatId,
      contentBlocks: blocks,
      bookmarked: (msg.bookmarked as boolean | undefined) ?? false,
      streamingState: (msg.streamingState as 'complete' | 'incomplete' | undefined) ?? 'complete',
    };
  });
  if (messageRows.length > 0) await db.messages.bulkAdd(messageRows);

  // ── Remap and write pills ─────────────────────────────────────────────────
  const pillRows: PillRow[] = payload.pills.map((pill) => ({
    ...pill,
    id: remap.fresh(pill.id),
    messageId: remap.map(pill.messageId) ?? pill.messageId,
    // Remap artefact id references inside the payload (I1 fix).
    payload: remapPillArtefactRefs(pill.payload, remap),
  }));
  if (pillRows.length > 0) await db.pills.bulkAdd(pillRows);

  // ── Remap and write attachments ───────────────────────────────────────────
  const attachmentRows: AttachmentRow[] = payload.attachments.map((att) => {
    const blobEntry = payload.blobs.get(att.id);
    return {
      ...att,
      id: remap.fresh(att.id),
      chatId: remap.map(att.chatId) ?? att.chatId,
      // messageId is null while pending (pre-send); remap only when non-null.
      messageId: att.messageId ? (remap.map(att.messageId) ?? att.messageId) : null,
      // Blob fields serialise to {} in JSON — guard against poison from pre-fix packs (I2).
      blob: blobEntry
        ? new Blob([new Uint8Array(blobEntry.bytes)], { type: blobEntry.mime })
        : att.blob instanceof Blob
          ? att.blob
          : undefined,
    };
  });
  if (attachmentRows.length > 0) await db.attachments.bulkAdd(attachmentRows);

  // ── Remap and write artefacts ─────────────────────────────────────────────
  const artefactRows = payload.artefacts.map((art) => {
    const blobEntry = payload.blobs.get(art.id);
    return {
      ...art,
      id: remap.fresh(art.id),
      chatId: remap.map(art.chatId) ?? art.chatId,
      personaId,
      // Blob fields serialise to {} in JSON — guard against poison from pre-fix packs (I2).
      blob: blobEntry
        ? new Blob([new Uint8Array(blobEntry.bytes)], { type: blobEntry.mime })
        : art.blob instanceof Blob
          ? art.blob
          : undefined,
      thumbBlob: art.thumbBlob instanceof Blob ? art.thumbBlob : undefined,
    };
  });
  if (artefactRows.length > 0) await db.artefacts.bulkAdd(artefactRows);

  // ── Remap and write compaction checkpoints ────────────────────────────────
  const checkpointRows: CompactionCheckpointRow[] = payload.checkpoints.map((cp) => ({
    ...cp,
    id: remap.fresh(cp.id),
    chatId: remap.map(cp.chatId) ?? cp.chatId,
    lastMessageIdBefore: remap.map(cp.lastMessageIdBefore) ?? cp.lastMessageIdBefore,
    tailStartMessageId: remap.map(cp.tailStartMessageId) ?? cp.tailStartMessageId,
    prevCheckpointId: cp.prevCheckpointId
      ? (remap.map(cp.prevCheckpointId) ?? cp.prevCheckpointId)
      : null,
  }));
  if (checkpointRows.length > 0) await db.compactionCheckpoints.bulkAdd(checkpointRows);

  // ── Remap and write memory ────────────────────────────────────────────────
  if (payload.memory) {
    const journalRows: MemoryJournalRow[] = payload.memory.journal.map((je) => ({
      ...je,
      id: remap.fresh(je.id),
      personaId,
    }));
    if (journalRows.length > 0) await db.memoryJournal.bulkAdd(journalRows);

    const bodyRows: MemoryBodyRow[] = payload.memory.bodies.map((body) => ({
      ...body,
      id: remap.fresh(body.id),
      personaId,
    }));
    if (bodyRows.length > 0) await db.memoryBody.bulkAdd(bodyRows);
  }

  return {
    personaId,
    modelBound,
    // Bindings are never transferred; always true so the UI can notify the user.
    droppedBindings: true,
  };
}

/**
 * Import a Chatsundere knowledge pack as a brand-new library.
 *
 * Vector strategy is resolved by comparing the pack's embed fingerprint against
 * the local engine's fingerprint:
 * - `adopt`: decode the exported vectors and upsert directly — no inference.
 * - `reembed`: mark documents pending and enqueue for local re-embedding.
 */
export async function importKnowledgePack(
  input: Blob,
  targetName: string,
): Promise<{ libraryId: string }> {
  const { manifest, payload } = await readKnowledgePack(input);
  const db = getClientDataDb();
  const remap = new IdRemap();
  const now = Date.now();

  // Mint a fresh library id.
  const libraryId = remap.fresh('library');

  const libraryRow: LibraryRow = {
    id: libraryId,
    name: targetName,
    description: payload.library.description,
    nsfw: payload.library.nsfw,
    createdAt: now,
    updatedAt: now,
  };
  await db.libraries.add(libraryRow);

  // Determine vector strategy by comparing the pack's embed fingerprint to the
  // local engine constants. If they match, the encoded vectors are directly
  // usable without running the model again.
  const strategy = resolveVectorStrategy(manifest.embed, {
    modelId: MODEL_ID,
    dim: EMBED_DIM,
    codecVersion: CODEC_VERSION,
  });

  // ── Write documents ───────────────────────────────────────────────────────
  const documentRows: DocumentRow[] = payload.documents.map((doc) => {
    const newDocId = remap.fresh(doc.id);
    return {
      ...doc,
      id: newDocId,
      libraryId,
      embeddingStatus: strategy === 'adopt' ? 'ready' : 'pending',
      embeddingError: null,
      // chunkCount is updated below for the adopt path once vectors are upserted.
      chunkCount: strategy === 'adopt' ? 0 : doc.chunkCount,
      createdAt: now,
      updatedAt: now,
    };
  });
  if (documentRows.length > 0) await db.documents.bulkAdd(documentRows);

  // ── Handle vectors by strategy ────────────────────────────────────────────
  if (strategy === 'adopt') {
    await adoptVectors(payload.vectors, remap, libraryId, now);
    // Update chunkCount on each document now that we know how many chunks landed.
    await updateChunkCounts(payload.vectors, remap, db);
  } else {
    // reembed: the embedding engine will generate fresh vectors on this device.
    for (const row of documentRows) {
      enqueueDocument(row.id);
    }
  }

  return { libraryId };
}

// ── Private helper ────────────────────────────────────────────────────────────

/**
 * Rewrite artefact id references inside a pill payload so they resolve to the
 * freshly-imported artefact ids. Handles the two known shapes:
 * - `{ artefactId: string }` — create_artefact tool-calls (ArtefactPill)
 * - `{ artefactIds: string[] }` — generate_image tool-calls (ImagePill)
 * All other payload shapes are returned unchanged.
 */
function remapPillArtefactRefs(raw: unknown, remap: IdRemap): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const p = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...p };
  const artefactId = p.artefactId;
  if (typeof artefactId === 'string') {
    next.artefactId = remap.map(artefactId) ?? artefactId;
  }
  const artefactIds = p.artefactIds;
  if (Array.isArray(artefactIds)) {
    next.artefactIds = artefactIds.map((x) => (typeof x === 'string' ? (remap.map(x) ?? x) : x));
  }
  return next;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Decode exported vectors and upsert them into the local vector store.
 * The embedding engine is NOT called — vectors are reused as-is.
 */
async function adoptVectors(
  vectors: ExportedVector[],
  remap: IdRemap,
  libraryId: string,
  now: number,
): Promise<void> {
  if (vectors.length === 0) return;

  const store = getKnowledgeVectorStore();
  const upsertItems = vectors.map((v) => {
    const newDocId = remap.map(v.documentId) ?? v.documentId;
    return {
      id: `${newDocId}#${v.chunkIndex}`,
      collection: KNOWLEDGE_COLLECTION,
      // decode returns Float32Array from the compact EncodedVector representation.
      vector: decode(v.encoded),
      tags: { libraryId, documentId: newDocId },
      numeric: { chunkIndex: v.chunkIndex },
      metadata: { text: v.text, headingPath: v.headingPath },
      updatedAt: now,
    };
  });
  await store.upsert(upsertItems);
}

/**
 * After upsert, set the correct `chunkCount` on each adopted document.
 * Counts vectors belonging to the new document id.
 */
async function updateChunkCounts(
  vectors: ExportedVector[],
  remap: IdRemap,
  db: ReturnType<typeof getClientDataDb>,
): Promise<void> {
  // Build a frequency map: newDocId → chunkCount.
  const counts = new Map<string, number>();
  for (const v of vectors) {
    const newDocId = remap.map(v.documentId) ?? v.documentId;
    counts.set(newDocId, (counts.get(newDocId) ?? 0) + 1);
  }
  for (const [docId, count] of counts) {
    await db.documents.update(docId, { chunkCount: count, updatedAt: Date.now() });
  }
}
