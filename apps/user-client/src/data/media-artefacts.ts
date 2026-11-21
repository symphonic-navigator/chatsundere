// SPDX-License-Identifier: AGPL-3.0-only
import { uuidv7 } from 'uuidv7';
import { type ArtefactRow, getClientDataDb } from '../boot/client-data-db.js';
import type { MediaProbe } from '../lib/media/media-probe.js';
import type { MediaKind } from '../mcp/media-extract.js';
import { mintBlobRefFor } from '../sync/blob-transform.js';
import { enqueueBlobPut, enqueueSync, isLinkedForSync } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { extensionForMime, slugify } from './artefacts.js';

/** The audio or video artefact already saved in this chat under the de-dup key, if any. */
export async function findMediaArtefactByKey(
  chatId: string,
  key: string,
): Promise<ArtefactRow | undefined> {
  return getClientDataDb()
    .artefacts.where('chatId')
    .equals(chatId)
    .filter((row) => row.mediaMeta?.key === key)
    .first();
}

export interface AddMediaArtefactInput {
  chatId: string;
  personaId: string;
  key: string;
  kind: MediaKind;
  mime: string;
  title: string;
  bytes: Blob;
  probe: MediaProbe;
  serverName: string;
  toolName: string;
}

/** Insert one audio or video file from an MCP result as an artefact and return its id. */
export async function addMediaArtefact(input: AddMediaArtefactInput): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const db = getClientDataDb();
  const linked = isLinkedForSync();
  const poster = input.probe.poster;
  // Class-1 creation with bytes, as for generated images (WS-D §5): the video
  // poster rides in `thumbBlob`, so blob sync needs no new field.
  const blobRef = linked ? mintBlobRefFor(input.bytes) : null;
  const thumbBlobRef = linked && poster ? mintBlobRefFor(poster.blob) : null;
  const row: ArtefactRow = {
    id,
    chatId: input.chatId,
    personaId: input.personaId,
    projectId: null,
    origin: 'generated',
    kind: input.kind,
    format: input.kind,
    title: input.title,
    fileName: `${slugify(input.title)}.${extensionForMime(input.mime)}`,
    mime: input.mime,
    content: '',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    blob: input.bytes,
    ...(poster ? { thumbBlob: poster.blob, width: poster.width, height: poster.height } : {}),
    ...(blobRef ? { blobRef } : {}),
    ...(thumbBlobRef ? { thumbBlobRef } : {}),
    mediaMeta: {
      key: input.key,
      durationMs: input.probe.durationMs,
      serverName: input.serverName,
      toolName: input.toolName,
    },
  };
  await db.transaction('rw', [db.artefacts, db.syncOutbox], async (tx) => {
    await db.artefacts.add(row);
    if (blobRef) enqueueBlobPut(tx, 'artefacts', id, blobRef.blobId);
    if (thumbBlobRef) enqueueBlobPut(tx, 'artefacts', id, thumbBlobRef.blobId);
    if (linked) enqueueSync(tx, 'artefacts', id, 'upsert');
  });
  if (linked) scheduleClass1Sync();
  return id;
}
