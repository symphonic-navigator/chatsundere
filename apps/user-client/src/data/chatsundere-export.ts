// SPDX-License-Identifier: AGPL-3.0-only

import type { EncodedVector } from '@chatsundere/embeddings';
import type { ArtefactRow, AttachmentRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { KNOWLEDGE_COLLECTION, getKnowledgeVectorStore } from '../boot/knowledge-vectors-db.js';
import type {
  ExportedVector,
  KnowledgePackPayload,
} from '../lib/chatsundere-transfer/knowledge-pack.js';
import { writeKnowledgePack } from '../lib/chatsundere-transfer/knowledge-pack.js';
import type {
  ExportedPersona,
  PersonaPackPayload,
} from '../lib/chatsundere-transfer/persona-pack.js';
import { writePersonaPack } from '../lib/chatsundere-transfer/persona-pack.js';
import { APP_VERSION } from '../lib/version.js';

/** Placeholder text substituted for each dropped image attachment when `images: false`. */
export const IMAGE_PLACEHOLDER_TEXT = 'Image not carried over in this transfer.';

/** Controls which optional data is included in a persona export. */
export interface PersonaExportOptions {
  /** Include the memory journal and bodies. */
  memory: boolean;
  /** Include text-kind artefacts. */
  artefacts: boolean;
  /** Include image attachments and image artefacts; replace dropped attachments with a placeholder. */
  images: boolean;
}

/**
 * Export a persona and all its associated data as a Chatsundere persona pack
 * (gzip-compressed ustar tarball Blob ready for `URL.createObjectURL` + download).
 *
 * Security invariant: `providerId`, `modelId`, `mcpOverrides`, `libraryIds`,
 * `lastInteractionAt`, and the provider's `apiKey` are never included. The
 * provider identity is represented only as a `modelRef`
 * (`{ providerTemplateId, modelId }`) resolved at export time.
 *
 * Switch semantics:
 * - `memory: false` → `payload.memory = null`.
 * - `artefacts: false` → text-kind artefacts are dropped.
 * - `images: false` → image-kind artefacts are dropped; each image attachment is
 *   replaced by a text attachment carrying `IMAGE_PLACEHOLDER_TEXT` (same `id` and
 *   position, so message context is preserved). Blob bytes are never written.
 */
export async function exportPersona(personaId: string, opts: PersonaExportOptions): Promise<Blob> {
  const db = getClientDataDb();

  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`exportPersona: persona ${personaId} not found`);

  // Resolve the provider's template id to build a portable modelRef. Null when
  // the provider no longer exists or no model is configured — the importer will
  // prompt for a re-pick.
  const provider = await db.providers.get(persona.providerId);
  const modelRef: ExportedPersona['modelRef'] = provider
    ? { providerTemplateId: provider.templateId, modelId: persona.modelId }
    : null;

  // Strip device-local and sensitive fields from the persona row. These are
  // either private (apiKey lives on the ProviderRow and never touches this
  // object, but belt-and-braces) or not portable (providerId, mcpOverrides,
  // libraryIds are device-specific bindings; lastInteractionAt is a UX datum).
  const {
    id: _id,
    providerId: _providerId,
    modelId: _modelId,
    mcpOverrides: _mcpOverrides,
    libraryIds: _libraryIds,
    lastInteractionAt: _lastInteractionAt,
    ...restPersona
  } = persona;
  const exportedPersona: ExportedPersona = { ...restPersona, modelRef };

  // --- Chats ---
  const chats = await db.chats.where('personaId').equals(personaId).toArray();
  const chatIds = chats.map((c) => c.id);

  // --- Messages & pills ---
  const messages = chatIds.length ? await db.messages.where('chatId').anyOf(chatIds).toArray() : [];
  const messageIds = messages.map((m) => m.id);
  const pills = messageIds.length
    ? await db.pills.where('messageId').anyOf(messageIds).toArray()
    : [];

  // --- Attachments (honour `images` switch; skip deleted) ---
  const rawAttachments = chatIds.length
    ? await db.attachments.where('chatId').anyOf(chatIds).toArray()
    : [];

  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>();
  const attachments: AttachmentRow[] = [];

  for (const att of rawAttachments) {
    if (att.state === 'deleted') continue;

    if (att.kind === 'image') {
      if (opts.images) {
        // Include the image blob in the pack.
        if (att.blob) {
          blobs.set(att.id, {
            bytes: new Uint8Array(await att.blob.arrayBuffer()),
            mime: att.mime,
          });
        }
        // Blob travels via the blobs map; strip it from the JSON row (I2 fix).
        attachments.push({ ...att, blob: undefined });
      } else {
        // Replace the image with a readable placeholder; emit no blob entry.
        const placeholder: AttachmentRow = {
          id: att.id,
          chatId: att.chatId,
          messageId: att.messageId,
          origin: att.origin,
          kind: 'text',
          fileName: att.fileName,
          mime: 'text/plain',
          order: att.order,
          state: 'active',
          createdAt: att.createdAt,
          updatedAt: att.updatedAt,
          text: IMAGE_PLACEHOLDER_TEXT,
        };
        attachments.push(placeholder);
      }
    } else {
      attachments.push(att);
    }
  }

  // --- Artefacts (honour `artefacts` and `images` switches) ---
  const rawArtefacts = chatIds.length
    ? await db.artefacts.where('chatId').anyOf(chatIds).toArray()
    : [];

  const artefacts: ArtefactRow[] = [];
  for (const art of rawArtefacts) {
    if (!opts.artefacts && art.kind === 'text') continue;
    if (!opts.images && art.kind === 'image') continue;
    if (opts.images && art.kind === 'image' && art.blob) {
      blobs.set(art.id, {
        bytes: new Uint8Array(await art.blob.arrayBuffer()),
        mime: art.mime,
      });
    }
    // Blob fields serialise to {} in JSON — carry bytes via the blobs map only (I2 fix).
    artefacts.push({ ...art, blob: undefined, thumbBlob: undefined });
  }

  // --- Compaction checkpoints ---
  const checkpoints = chatIds.length
    ? await db.compactionCheckpoints.where('chatId').anyOf(chatIds).toArray()
    : [];

  // --- Memory ---
  let memory: PersonaPackPayload['memory'] = null;
  if (opts.memory) {
    const journal = await db.memoryJournal.where('personaId').equals(personaId).toArray();
    const bodies = await db.memoryBody.where('personaId').equals(personaId).toArray();
    memory = { journal, bodies };
  }

  // --- Avatar (always travels) ---
  const avatarRow = await db.personaAvatars.get(personaId);
  let avatar: PersonaPackPayload['avatar'] = null;
  if (avatarRow) {
    avatar = {
      bytes: new Uint8Array(await avatarRow.blob.arrayBuffer()),
      mime: avatarRow.mime,
    };
  }

  const payload: PersonaPackPayload = {
    persona: exportedPersona,
    avatar,
    chats,
    messages,
    pills,
    attachments,
    artefacts,
    checkpoints,
    memory,
    blobs,
    included: { memory: opts.memory, artefacts: opts.artefacts, images: opts.images },
  };

  return writePersonaPack(payload, {
    exportedAt: new Date(Date.now()).toISOString(),
    appVersion: APP_VERSION.version,
  });
}

/**
 * Export a knowledge library — its metadata, documents, and embedding vectors —
 * as a Chatsundere knowledge pack (gzip-compressed ustar tarball). The library
 * `id` is stripped; the importer assigns a fresh id.
 */
export async function exportLibrary(libraryId: string): Promise<Blob> {
  const db = getClientDataDb();

  const library = await db.libraries.get(libraryId);
  if (!library) throw new Error(`exportLibrary: library ${libraryId} not found`);

  const documents = await db.documents.where('libraryId').equals(libraryId).toArray();

  const store = getKnowledgeVectorStore();
  const rows = await store.scan({
    collection: KNOWLEDGE_COLLECTION,
    filter: { tags: { libraryId } },
  });

  // Map VectorRows to the portable ExportedVector shape. `metadata` is typed as
  // `unknown` in the store schema; we wrote `{ text, headingPath }` during ingestion.
  type ChunkMeta = { text?: string; headingPath?: string[] };
  const vectors: ExportedVector[] = rows.map((row) => {
    const meta = row.metadata as ChunkMeta | undefined;
    // Extract only the EncodedVector fields — drop store-internal columns
    // (id, collection, tags, numeric, updatedAt, bytes).
    const encoded: EncodedVector = {
      version: row.version,
      codes: row.codes,
      scales: row.scales,
      offsets: row.offsets,
      scaleMax: row.scaleMax,
      offMin: row.offMin,
      offMax: row.offMax,
      norm: row.norm,
    };
    return {
      documentId: row.tags.documentId ?? '',
      chunkIndex: row.numeric.chunkIndex ?? 0,
      text: meta?.text ?? '',
      headingPath: meta?.headingPath ?? [],
      encoded,
    };
  });

  const { id: _id, ...libraryWithoutId } = library;

  const payload: KnowledgePackPayload = {
    library: libraryWithoutId,
    documents,
    vectors,
  };

  return writeKnowledgePack(payload, {
    exportedAt: new Date(Date.now()).toISOString(),
    appVersion: APP_VERSION.version,
  });
}
