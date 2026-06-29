// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ArtefactRow,
  AttachmentRow,
  ChatRow,
  CompactionCheckpointRow,
  MemoryBodyRow,
  MemoryJournalRow,
  MessageRow,
  PersonaRow,
  PillRow,
} from '../../boot/client-data-db.js';
import { type TarFile, gzip, tar } from '../archive/tar-write.js';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type PersonaManifest, TRANSFER_VERSION } from './manifest.js';

export type ExportedPersona = Omit<
  PersonaRow,
  'id' | 'providerId' | 'modelId' | 'mcpOverrides' | 'libraryIds' | 'lastInteractionAt'
> & { modelRef: { providerTemplateId: string; modelId: string } | null };

export interface PersonaPackPayload {
  persona: ExportedPersona;
  avatar: { bytes: Uint8Array; mime: string } | null;
  chats: ChatRow[];
  messages: MessageRow[];
  pills: PillRow[];
  attachments: AttachmentRow[];
  artefacts: ArtefactRow[];
  checkpoints: CompactionCheckpointRow[];
  memory: { journal: MemoryJournalRow[]; bodies: MemoryBodyRow[] } | null;
  blobs: Map<string, { bytes: Uint8Array; mime: string }>;
  included: { memory: boolean; artefacts: boolean; images: boolean };
}

const enc = new TextEncoder();

function json(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

function extFor(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

export interface WritePersonaPackOptions {
  exportedAt?: string;
  appVersion?: string;
}

/** Serialise a `PersonaPackPayload` to a gzip-compressed ustar tarball `Blob`. */
export async function writePersonaPack(
  payload: PersonaPackPayload,
  opts: WritePersonaPackOptions = {},
): Promise<Blob> {
  const manifest: PersonaManifest = {
    format: 'chatsundere/persona',
    version: TRANSFER_VERSION,
    exportedAt: opts.exportedAt ?? '',
    appVersion: opts.appVersion ?? '',
    included: payload.included,
    source: { personaName: payload.persona.name },
  };

  const files: TarFile[] = [
    { name: 'manifest.json', bytes: json(manifest) },
    { name: 'persona.json', bytes: json(payload.persona) },
    { name: 'chats.json', bytes: json(payload.chats) },
    { name: 'messages.json', bytes: json(payload.messages) },
    { name: 'pills.json', bytes: json(payload.pills) },
    { name: 'attachments.json', bytes: json(payload.attachments) },
    { name: 'artefacts.json', bytes: json(payload.artefacts) },
    { name: 'compactions.json', bytes: json(payload.checkpoints) },
  ];

  if (payload.avatar) {
    files.push({ name: `avatar.${extFor(payload.avatar.mime)}`, bytes: payload.avatar.bytes });
  }
  if (payload.memory) {
    files.push({ name: 'memory.json', bytes: json(payload.memory) });
  }
  for (const [id, blob] of payload.blobs) {
    files.push({ name: `blobs/${id}.${extFor(blob.mime)}`, bytes: blob.bytes });
  }

  const gzRaw = await gzip(tar(files));
  // Copy into a fresh ArrayBuffer so the Uint8Array type is Uint8Array<ArrayBuffer>
  // (not ArrayBufferLike), which is required by the Blob constructor's BlobPart type.
  const gz: Uint8Array<ArrayBuffer> = new Uint8Array(gzRaw);
  return new Blob([gz], { type: 'application/gzip' });
}

// ──────────────────────────────────────────────────────────────────────────────
// Reader
// ──────────────────────────────────────────────────────────────────────────────

const dec = new TextDecoder();

function parseJson<T>(files: Map<string, Uint8Array>, name: string, fallback: T): T {
  const bytes = files.get(name);
  return bytes ? (JSON.parse(dec.decode(bytes)) as T) : fallback;
}

function mimeFromExt(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export interface ParsedPersonaPack {
  manifest: PersonaManifest;
  payload: PersonaPackPayload;
}

/** Deserialise a Chatsundere persona pack (gzip-compressed ustar tarball) back into a `PersonaPackPayload`. */
export async function readPersonaPack(input: Blob | Uint8Array): Promise<ParsedPersonaPack> {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzip(raw);
  } catch {
    throw new Error('Could not read this file — is it a Chatsundere export?');
  }
  const files = new Map<string, Uint8Array>();
  for (const e of untar(tarBytes)) files.set(e.name, e.bytes);
  const manifest = parseJson<PersonaManifest | null>(files, 'manifest.json', null);
  if (!manifest || manifest.format !== 'chatsundere/persona') {
    throw new Error('This file is not a Chatsundere persona export.');
  }

  let avatar: PersonaPackPayload['avatar'] = null;
  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>();
  for (const [name, bytes] of files) {
    if (name.startsWith('avatar.')) avatar = { bytes, mime: mimeFromExt(name) };
    else if (name.startsWith('blobs/')) {
      const id = name.slice('blobs/'.length).replace(/\.[^.]+$/, '');
      blobs.set(id, { bytes, mime: mimeFromExt(name) });
    }
  }

  const persona = parseJson<ExportedPersona | null>(files, 'persona.json', null);
  if (!persona) {
    throw new Error('This persona export appears to be corrupt — persona data is missing.');
  }

  const payload: PersonaPackPayload = {
    persona,
    avatar,
    chats: parseJson(files, 'chats.json', []),
    messages: parseJson(files, 'messages.json', []),
    pills: parseJson(files, 'pills.json', []),
    attachments: parseJson(files, 'attachments.json', []),
    artefacts: parseJson(files, 'artefacts.json', []),
    checkpoints: parseJson(files, 'compactions.json', []),
    memory: parseJson(files, 'memory.json', null),
    blobs,
    included: manifest.included,
  };
  return { manifest, payload };
}
