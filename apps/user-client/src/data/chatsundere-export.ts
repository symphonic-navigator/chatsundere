// SPDX-License-Identifier: AGPL-3.0-only

import { encryptExportPack } from '@chatsundere/crypto';
import type { EnclosedFormat } from '@chatsundere/crypto';
import type { EncodedVector } from '@chatsundere/embeddings';
import type { SyncCollection } from '@chatsundere/shared-types';
import type { ArtefactRow, AttachmentRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { KNOWLEDGE_COLLECTION, getKnowledgeVectorStore } from '../boot/knowledge-vectors-db.js';
import { wrapEncrypted } from '../lib/chatsundere-transfer/encrypted-container.js';
import type {
  ExportedVector,
  KnowledgePackPayload,
} from '../lib/chatsundere-transfer/knowledge-pack.js';
import { writeKnowledgePack } from '../lib/chatsundere-transfer/knowledge-pack.js';
import type {
  ExportedPersona,
  PersonaPackPayload,
} from '../lib/chatsundere-transfer/persona-pack.js';
import {
  thumbBlobKey,
  withoutVaultFields,
  writePersonaPack,
} from '../lib/chatsundere-transfer/persona-pack.js';
import { APP_VERSION } from '../lib/version.js';
import { fetchRowBlob, resolveBlobBytes } from '../sync/blob-fetch.js';

/** Encrypt a plaintext pack Blob under `password` when one is given; otherwise return it unchanged. */
async function maybeEncrypt(
  plain: Blob,
  enclosedFormat: EnclosedFormat,
  password: string | undefined,
  meta: { exportedAt: string; appVersion: string },
): Promise<Blob> {
  if (!password) return plain;
  const bytes = new Uint8Array(await plain.arrayBuffer());
  const container = await encryptExportPack(password, bytes, enclosedFormat);
  return wrapEncrypted(container, meta);
}

/** How long an export waits for one file from the vault before leaving it out. */
export const EXPORT_FETCH_TIMEOUT_MS = 20_000;

/**
 * The bytes of a row's blob field: the local copy, else fetched from the vault
 * (which also hydrates the row). `null` when they cannot be had on this device:
 * the oversize sentinel, no ref, no key material, offline, or a failed fetch.
 */
async function localOrFetched(
  collection: SyncCollection,
  key: string,
  field: string,
): Promise<Blob | null> {
  const state = await resolveBlobBytes(collection, key, field);
  if (state.kind === 'ready') return state.bytes;
  if (state.kind === 'terminal') return null;
  // The transport takes no AbortSignal, so a stalled connection is raced, not
  // cancelled: the export moves on and counts the file as missing, while the fetch
  // may still finish onto the row in the background.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EXPORT_FETCH_TIMEOUT_MS);
  });
  try {
    const fetched = await Promise.race([fetchRowBlob(collection, key, field, state.ref), timedOut]);
    return fetched?.state === 'ready' && fetched.bytes ? fetched.bytes : null;
  } finally {
    clearTimeout(timer);
  }
}

/** The notice for files an export had to leave out because their bytes are not here. */
export function missingFilesNotice(n: number): string {
  return n === 1
    ? '1 file could not be included because it is not on this device.'
    : `${n} files could not be included because they are not on this device.`;
}

/** Placeholder text substituted for each dropped image attachment when `images: false`. */
export const IMAGE_PLACEHOLDER_TEXT = 'Image not carried over in this transfer.';

/** Controls which optional data is included in a persona export. */
export interface PersonaExportOptions {
  /** Include the memory journal and bodies. */
  memory: boolean;
  /** Include text-kind artefacts. */
  artefacts: boolean;
  /** Include image attachments and image, audio and video artefacts; replace
   *  dropped image attachments with a placeholder. */
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
 * - `images: false` → image, audio and video artefacts are dropped; each image attachment is
 *   replaced by a text attachment carrying `IMAGE_PLACEHOLDER_TEXT` (same `id` and
 *   position, so message context is preserved). Blob bytes are never written.
 */
export async function exportPersona(
  personaId: string,
  opts: PersonaExportOptions,
  password?: string,
): Promise<Blob> {
  return (await exportPersonaWithReport(personaId, opts, password)).blob;
}

/** What an export produced, and how many files it had to leave out. */
export interface PersonaExportResult {
  blob: Blob;
  /** Files that should have travelled but whose bytes are not on this device. */
  missingFiles: number;
}

/**
 * {@link exportPersona}, also reporting the files it could not include. Bytes
 * that live only in the vault (synced here, never opened) are fetched first, so
 * only files this device genuinely cannot get are left out, and counted.
 */
export async function exportPersonaWithReport(
  personaId: string,
  opts: PersonaExportOptions,
  password?: string,
): Promise<PersonaExportResult> {
  const db = getClientDataDb();
  let missingFiles = 0;

  const persona = await db.personas.get(personaId);
  if (!persona) throw new Error(`exportPersona: persona ${personaId} not found`);

  // Resolve the provider's template id to build a portable modelRef. Null when
  // the provider no longer exists or no model is configured — the importer will
  // prompt for a re-pick.
  const provider = await db.providers.get(persona.providerId);
  const modelRef: ExportedPersona['modelRef'] =
    provider && provider.apiKey !== null
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
        const bytes = await localOrFetched('attachments', att.id, 'blob');
        if (bytes) {
          blobs.set(att.id, { bytes: new Uint8Array(await bytes.arrayBuffer()), mime: att.mime });
        } else missingFiles++;
        // Blob travels via the blobs map; strip it from the JSON row (I2 fix).
        attachments.push(withoutVaultFields({ ...att, blob: undefined }));
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
      attachments.push(withoutVaultFields(att));
    }
  }

  // --- Artefacts (honour `artefacts` and `images` switches) ---
  const rawArtefacts = chatIds.length
    ? await db.artefacts.where('chatId').anyOf(chatIds).toArray()
    : [];

  const artefacts: ArtefactRow[] = [];
  for (const art of rawArtefacts) {
    const media = art.kind === 'audio' || art.kind === 'video';
    if (!opts.artefacts && art.kind === 'text') continue;
    if (!opts.images && (art.kind === 'image' || media)) continue;
    if (opts.images && (art.kind === 'image' || media)) {
      const bytes = await localOrFetched('artefacts', art.id, 'blob');
      if (bytes) {
        blobs.set(art.id, { bytes: new Uint8Array(await bytes.arrayBuffer()), mime: art.mime });
      } else missingFiles++;
    }
    // A video's poster is not regenerated on import, so it travels too. It is not
    // counted when missing: the video itself still plays without it.
    if (opts.images && media) {
      const poster = await localOrFetched('artefacts', art.id, 'thumbBlob');
      if (poster) {
        blobs.set(thumbBlobKey(art.id), {
          bytes: new Uint8Array(await poster.arrayBuffer()),
          mime: poster.type || 'image/jpeg',
        });
      }
    }
    // Blob fields serialise to {} in JSON — carry bytes via the blobs map only (I2 fix).
    artefacts.push(withoutVaultFields({ ...art, blob: undefined, thumbBlob: undefined }));
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
  // A removed avatar (WS-D §4) keeps its row with the bytes cleared — export
  // nothing for it (the pack simply carries no avatar).
  if (avatarRow?.blob) {
    avatar = {
      bytes: new Uint8Array(await avatarRow.blob.arrayBuffer()),
      mime: avatarRow.mime,
    };
  } else if (avatarRow?.blobRef) {
    // Synced from another device and never shown here: fetch it like any other file.
    const bytes = await localOrFetched('personaAvatars', personaId, 'blob');
    if (bytes) avatar = { bytes: new Uint8Array(await bytes.arrayBuffer()), mime: avatarRow.mime };
    else missingFiles++;
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

  const meta = { exportedAt: new Date(Date.now()).toISOString(), appVersion: APP_VERSION.version };
  const plain = await writePersonaPack(payload, meta);
  const blob = await maybeEncrypt(plain, 'chatsundere/persona', password, meta);
  return { blob, missingFiles };
}

/**
 * Export a knowledge library — its metadata, documents, and embedding vectors —
 * as a Chatsundere knowledge pack (gzip-compressed ustar tarball). The library
 * `id` is stripped; the importer assigns a fresh id.
 */
export async function exportLibrary(libraryId: string, password?: string): Promise<Blob> {
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

  const meta = { exportedAt: new Date(Date.now()).toISOString(), appVersion: APP_VERSION.version };
  const plain = await writeKnowledgePack(payload, meta);
  return maybeEncrypt(plain, 'chatsundere/knowledge', password, meta);
}
