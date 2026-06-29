// SPDX-License-Identifier: AGPL-3.0-only
import {
  CODEC_VERSION,
  EMBED_DIM,
  type EncodedVector,
  MODEL_ID,
  deserialise,
  serialise,
} from '@chatsundere/embeddings';
import type { DocumentRow, LibraryRow } from '../../boot/client-data-db.js';
import { type TarFile, gzip, tar } from '../archive/tar-write.js';
import { gunzip, untar } from '../chatsune-import/archive-reader.js';
import { type KnowledgeManifest, TRANSFER_VERSION } from './manifest.js';

/** One embedding vector with its provenance metadata. */
export interface ExportedVector {
  documentId: string;
  chunkIndex: number;
  headingPath: string[];
  text: string;
  encoded: EncodedVector;
}

/** The full payload of a knowledge-pack export. */
export interface KnowledgePackPayload {
  library: Omit<LibraryRow, 'id'>;
  documents: DocumentRow[];
  vectors: ExportedVector[];
}

/** Sidecar entry in vectors.json — offsets into the binary vectors.bin blob. */
interface VectorSidecarEntry {
  documentId: string;
  chunkIndex: number;
  headingPath: string[];
  text: string;
  byteOffset: number;
  byteLength: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Encode a value as JSON bytes. */
function j(v: unknown): Uint8Array {
  return enc.encode(JSON.stringify(v));
}

/** Parse a named file from the archive map, returning a typed fallback when absent. */
function parseFile<T>(files: Map<string, Uint8Array>, name: string, fallback: T): T {
  const b = files.get(name);
  return b ? (JSON.parse(dec.decode(b)) as T) : fallback;
}

/**
 * Write a knowledge-pack archive: a gzipped tar containing the library metadata,
 * documents, and embedding vectors (binary blob + JSON sidecar).
 */
export async function writeKnowledgePack(
  payload: KnowledgePackPayload,
  opts: { exportedAt?: string; appVersion?: string } = {},
): Promise<Blob> {
  // Build the binary vector blob and the JSON sidecar tracking offsets.
  const sidecar: VectorSidecarEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const v of payload.vectors) {
    const bytes = serialise(v.encoded);
    sidecar.push({
      documentId: v.documentId,
      chunkIndex: v.chunkIndex,
      headingPath: v.headingPath,
      text: v.text,
      byteOffset: offset,
      byteLength: bytes.length,
    });
    chunks.push(bytes);
    offset += bytes.length;
  }

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    bin.set(c, o);
    o += c.length;
  }

  const manifest: KnowledgeManifest = {
    format: 'chatsundere/knowledge',
    version: TRANSFER_VERSION,
    exportedAt: opts.exportedAt ?? '',
    appVersion: opts.appVersion ?? '',
    embed: { modelId: MODEL_ID, dim: EMBED_DIM, codecVersion: CODEC_VERSION },
    source: { libraryName: payload.library.name },
  };

  const files: TarFile[] = [
    { name: 'manifest.json', bytes: j(manifest) },
    { name: 'library.json', bytes: j(payload.library) },
    { name: 'documents.json', bytes: j(payload.documents) },
    { name: 'vectors.json', bytes: j(sidecar) },
    { name: 'vectors.bin', bytes: bin },
  ];

  const gzRaw = await gzip(tar(files));
  // Copy into a fresh ArrayBuffer so the Uint8Array type is Uint8Array<ArrayBuffer>
  // (not ArrayBufferLike), which is required by the Blob constructor's BlobPart type.
  const gz: Uint8Array<ArrayBuffer> = new Uint8Array(gzRaw);
  return new Blob([gz], { type: 'application/gzip' });
}

/**
 * Read and validate a knowledge-pack archive produced by `writeKnowledgePack`.
 * Accepts a Blob (browser file-picker) or a raw Uint8Array (test / Node usage).
 */
export async function readKnowledgePack(
  input: Blob | Uint8Array,
): Promise<{ manifest: KnowledgeManifest; payload: KnowledgePackPayload }> {
  const raw = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());

  let tarBytes: Uint8Array;
  try {
    tarBytes = await gunzip(raw);
  } catch {
    throw new Error('Could not read this file — is it a Chatsundere export?');
  }

  const files = new Map<string, Uint8Array>();
  for (const e of untar(tarBytes)) files.set(e.name, e.bytes);

  const manifest = parseFile<KnowledgeManifest | null>(files, 'manifest.json', null);
  if (!manifest || manifest.format !== 'chatsundere/knowledge') {
    throw new Error('This file is not a Chatsundere library export.');
  }

  const sidecar = parseFile<VectorSidecarEntry[]>(files, 'vectors.json', []);
  const bin = files.get('vectors.bin') ?? new Uint8Array(0);

  const vectors: ExportedVector[] = sidecar.map((s) => ({
    documentId: s.documentId,
    chunkIndex: s.chunkIndex,
    headingPath: s.headingPath,
    text: s.text,
    encoded: deserialise(bin.subarray(s.byteOffset, s.byteOffset + s.byteLength)),
  }));

  // library.json is mandatory in a valid archive; throw if absent.
  const libraryBuf = files.get('library.json');
  if (!libraryBuf) {
    throw new Error('This file is not a valid Chatsundere library export (missing library.json).');
  }

  return {
    manifest,
    payload: {
      library: JSON.parse(dec.decode(libraryBuf)) as KnowledgePackPayload['library'],
      documents: parseFile<DocumentRow[]>(files, 'documents.json', []),
      vectors,
    },
  };
}
