// SPDX-License-Identifier: AGPL-3.0-only

import type { ImageModelConfig } from '@chatsundere/llm-unified';
import type { BlobRef, SyncCollection } from '@chatsundere/shared-types';
import Dexie, { type Table } from 'dexie';
import { pickProviderSurvivor } from '../data/provider-dedup.js';
import type { EncryptedBlob } from '../lib/secrets.js';
import type { TtsHighpassSetting } from '../lib/voice/voice-filter.js';
import type { WebBackendSetting } from '../lib/web-backends.js';
import type { McpToolDefinition } from '../mcp/types.js';

export const DB_NAME = 'chatsundere_client_data';

// ===== Row types =====

export interface SettingsRow {
  id: 1;
  displayName: string;
  globalInstructions: string;
  globalAboutMe: string;
  defaultMindspaceId: string;
  userTexture: MindspaceTexture;
  animationsEnabled: boolean;
  adultMode: 'nsfw' | 'sfw';
  corsProxy: { url: string; sharedKey: EncryptedBlob } | null;
  webInterfacing: { search: WebBackendSetting; fetch: WebBackendSetting };
  /** Independent web search/fetch backends for the expert uplink. null fields mean "auto"
   *  (resolved to exa+neural when available). searchTierId controls search depth. */
  expertWeb: { search: WebBackendSetting; fetch: WebBackendSetting; searchTierId: string | null };
  /** Global substitute vision model — an offering ref "providerId:upstreamSlug"; null = none. */
  substituteVisionModel: string | null;
  /** Global expert model — an offering ref "templateId:upstreamSlug"; null = none.
   *  Forwards a single sanitised question via the ask_expert tool. */
  expertModel: string | null;
  /** Global artefact-expert model — an offering ref "templateId:upstreamSlug";
   *  absent ⇒ null = none. When set, chats delegate artefact creation to this
   *  model unless the chat opts out (`ChatRow.useArtefactExpertModel`).
   *  Non-indexed (schemaless) — no Dexie version bump. */
  artefactExpertModel?: string | null;
  /** Identity-binding tag (non-secret, one-way `deriveIdentityTag` of the owning
   *  MasterKey). Bound at boot by `enforceClientDataIdentity`; a mismatch means
   *  this store belongs to a different identity and is wiped. Non-indexed
   *  (schemaless) — no Dexie version bump. */
  identityTag?: string;
  /** Global image-generation models. `ref` = "providerTemplateId:upstreamSlug".
   *  `primary` drives generate_image; `nsfw` is the NSFW-capable second slot
   *  (spec 2026-06-09 §6). Both null until the user picks. */
  imageGeneration: {
    primary: { ref: string; config: ImageModelConfig } | null;
    nsfw: { ref: string; config: ImageModelConfig } | null;
  };
  /** Voice playback granularity: paragraph = one segment per paragraph,
   *  sentence = one segment per sentence. */
  voiceMode: 'paragraph' | 'sentence';
  /** Dictation: VAD sensitivity preset (energy thresholds, chatsune-tuned). */
  dictationSensitivity: 'low' | 'medium' | 'high';
  /** Dictation: VAD redemption window (silence tolerance) in ms. */
  dictationRedemptionMs: number;
  /** Dictation: send each completed transcription immediately instead of drafting. */
  dictationAutoSend: boolean;
  /** Read-aloud TTS offering ref "providerId:upstreamSlug"; null = curated auto-default. */
  ttsOffering: string | null;
  /** Dictation STT offering ref "providerId:upstreamSlug"; null = curated auto-default. */
  sttOffering: string | null;
  /** Voice mode: auto-read each newly generated persona reply aloud as it
   *  streams (behaviour-axis setting — global, persisted). */
  autoReadAloud: boolean;
  /** One-shot: the "voice mode is still on" hint shown the first time the user
   *  stops playback while the mode is on. */
  voiceStopHintSeen: boolean;
  /** Spectrum analyser: master on/off (behaviour-axis setting — global, persisted). */
  spectrumEnabled: boolean;
  /** Screen effects: master on/off for inline emoji-shower flourishes the persona
   *  may emit (behaviour-axis setting — global, persisted). Display glow always
   *  renders; only the full-screen overlay is gated on this. */
  screenEffectsEnabled: boolean;
  /** Spectrum analyser: bar render style. */
  spectrumStyle: 'sharp' | 'soft' | 'glow';
  /** Spectrum analyser: bar opacity, clamped [0.05, 0.80]. */
  spectrumOpacity: number;
  /** Spectrum analyser: number of bars, clamped [16, 96]. */
  spectrumBarCount: number;
  /** TTS cleanup high-pass: 'auto' follows the offering recommendation, 'off'
   *  disables it, 50/100 force a fixed cut-off (behaviour-axis — global). */
  ttsHighpass: TtsHighpassSetting;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderRow {
  id: string;
  templateId: string;
  displayName: string;
  baseUrl: string;
  apiKey: EncryptedBlob;
  /** The AAD slot the `apiKey` blob is sealed under: `provider/<keySlot>/api-key`.
   *  Decoupled from `id` so the v35 id→templateId rekey preserves existing sealed
   *  blobs without a re-seal (spec §4). Absent on pre-v35 rows → callers fall back
   *  to `id`. Non-indexed (schemaless) — no Dexie version bump of its own. */
  keySlot?: string;
  routing: { kind: 'direct' } | { kind: 'cors-proxy' };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  prefix: string;
  auth:
    | { scheme: 'bearer'; key: EncryptedBlob }
    | { scheme: 'header'; headerName: string; key: EncryptedBlob }
    | null;
  onByDefault: boolean;
  autoRun: boolean;
  enabled: boolean;
  /** User intent: may this server be reached directly (CORS required)? Off → proxy-only. */
  allowDirect: boolean;
  routing: 'direct' | 'proxy' | null;
  resolvedEndpoint: string | null;
  tools: McpToolDefinition[];
  hiddenTools: string[];
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MindspacePalette {
  bg: string;
  surfaceBase: string;
  surfaceRaised: string;
  surfaceInput: string;
  accent: string;
  accentSubtle: string;
  accentBorder: string;
  accentBorderActive: string;
  accentGlow: string;
  text: {
    primary: string;
    secondary: string;
    muted: string;
    ghost: string;
  };
}

export type MindspaceTexture = 'cloudy' | 'aurora' | 'grain';

export interface MindspaceRow {
  id: string;
  displayName: string;
  palette: MindspacePalette;
  texture: MindspaceTexture;
  builtIn: boolean;
  createdAt: number;
  /** LWW clock for sync conflict resolution (§7.5). Stamped by the v33
   *  migration on pre-existing rows; written on every mutation thereafter. */
  updatedAt: number;
}

export interface PersonaRow {
  id: string;
  name: string;
  tagline: string;
  colour: string;
  font: 'sans' | 'serif' | 'cursive';
  instructions: string;
  /** Canonical model id (Slice 2). null = not set → user must re-pick. */
  canonicalId: string | null;
  providerId: string;
  modelId: string;
  /** Optional background-helper model — runs this persona's unattended chores
   *  (title generation, memory, compaction) instead of the persona's own model,
   *  so a "thinks-then-stops" model (DeepSeek) stays in the conversation while a
   *  reliable helper does the chores. `backgroundCanonicalId` null/absent ⇒ unset
   *  → the persona's own model runs the chores. Non-indexed; no Dexie bump. */
  backgroundCanonicalId?: string | null;
  backgroundProviderId?: string;
  backgroundModelId?: string;
  /** Let the background helper write the opening greeting too. Absent ⇒ false
   *  (the persona's own model greets). Only meaningful when a helper is set. */
  greetingUsesBackgroundModel?: boolean;
  mindspaceId: string | null;
  aboutMeOverride: string | null;
  textureOverride: MindspaceTexture | null;
  temperature: number;
  adultPersona: boolean;
  chatsundereTonality: boolean;
  /** Per-persona context window in tokens. null = use the offering's recommended. */
  contextWindow: number | null;
  /** Knowledge libraries assigned to this persona (Chunk B). */
  libraryIds: string[];
  /** Default on/off state of the per-chat ask_expert runtime toggle for new chats
   *  of this persona. false = off (opt-in uplink). */
  askExpertDefault: boolean;
  /** Per-persona MCP server overrides. Unset key → server.onByDefault applies. */
  mcpOverrides: Record<string, 'on' | 'off'>;
  /** Roleplay mode — the persona embodies a character (curated Band-1 blocks). */
  roleplay: boolean;
  /** Narration perspective for roleplay (asterisk narration). */
  narration: 'first' | 'third';
  /** The persona opens every new chat with a generated greeting. */
  greetingEnabled: boolean;
  /** User-authored rules the opener is composed from. */
  greetingInstructions: string;
  /** TTS voice id for this persona's spoken dialogue. null = TTS not configured. */
  voice: string | null;
  /** TTS voice id for asterisk narration lines. null = use voice, or TTS not configured. */
  narratorVoice: string | null;
  /** Long-term memory enabled for this persona. Absent ⇒ true (resolve with `?? true`). */
  useMemory?: boolean;
  /** User-authored guidance on what to remember. Absent ⇒ '' . */
  memoryInstructions?: string;
  /** Highest memory-body version the user has viewed; drives the Cockpit active-state (Plan 2). Absent ⇒ 0. */
  lastViewedMemoryBodyVersion?: number;
  /** One-shot "starting to remember you" note already shown. Absent ⇒ false. */
  memoryIntroShown?: boolean;
  /** Last time the user actually sent a message to this persona (any chat).
   *  Drives Circle ordering. The auto-opener does NOT update it. */
  lastInteractionAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRow {
  id: string;
  personaId: string;
  title: string | null;
  resolvedMindspaceId: string;
  createdAt: number;
  /** LWW clock for sync conflict resolution (§7.5). Stamped by the v33
   *  migration on pre-existing rows; written on every mutation thereafter.
   *  Distinct from the derived `lastMessageAt` (never synced). */
  updatedAt: number;
  lastMessageAt: number;
  bookmarkedMessageCount: number;
  draftInput: string; // NEW — Phase 3 cockpit autosave
  /** Ad-hoc knowledge libraries for this chat only (Chunk B). */
  libraryIds: string[];
  /** Creation-time snapshot: persona had greetingEnabled, opener not yet
   *  delivered. Cleared on opener completion, stop, or first user send.
   *  Never set retroactively — flipping the persona switch later must not
   *  retrofit openers onto existing chats. */
  openerPending?: boolean;
  /** chatsune session `original_id` when this chat was imported from a Chatsune
   *  persona export; absent for natively-created chats. Non-indexed (schemaless,
   *  like `bookmarkLabel`/`kind`) — dedup loads a persona's chats via the
   *  `personaId` index and builds the seen-set in memory, so no Dexie version
   *  bump is needed. */
  importedFrom?: string | null;
  /** Extraction cursor: id of the newest user message already fed to memory
   *  extraction. uuidv7 ids are time-ordered, so "newer than the cursor" is an
   *  id comparison. Absent ⇒ null (nothing extracted yet). Non-indexed. */
  lastExtractedMessageId?: string | null;
  /** Active compaction checkpoint id (its summary is injected; history slices to its tail). */
  activeCompactionId?: string | null;
  /** Once-per-chat flag: the 80 % "compact?" toast has been shown. */
  compactionToastShown?: boolean;
  /** Per-chat opt-out for the global artefact expert (`SettingsRow.
   *  artefactExpertModel`): absent ⇒ true (use the expert when one is set).
   *  Only meaningful while a global artefact expert is configured.
   *  Non-indexed (schemaless) — no Dexie version bump. */
  useArtefactExpertModel?: boolean;
  /** Message currently being re-composed in this chat's composer (spec
   *  2026-07-18). Device-local edit-in-progress marker — never synced (on the
   *  `chats` deny-list), never determines "is this the last message" (that is
   *  always derived live). Non-indexed (schemaless) — no Dexie version bump. */
  editingMessageId?: string | null;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pill'; pillId: string }
  /** `hiddenTokens` marks a reasoning block whose trace text the provider never
   *  surfaced (Inkling via nano-gpt's passthrough gap): `text` is empty and
   *  `hiddenTokens` carries the billed reasoning-token count, rendered as a
   *  terminal "(hidden reasoning, n tokens)" marker. Non-indexed JSON, so
   *  widening the union needs no Dexie version bump. */
  | { type: 'reasoning'; text: string; hiddenTokens?: number };

export interface MessageRow {
  id: string;
  chatId: string;
  role: 'user' | 'persona' | 'system';
  contentBlocks: ContentBlock[];
  createdAt: number;
  /** LWW clock for sync conflict resolution (§7.5). Stamped by the v33
   *  migration on pre-existing rows; written on every mutation thereafter. */
  updatedAt: number;
  bookmarked: boolean;
  /** Custom bookmark name. `null`/absent ⇒ derive the default snippet from
   *  the message text. Non-indexed: Dexie stores it schemalessly, so adding
   *  it needs no version bump. */
  bookmarkLabel?: string | null;
  /** 'opener' = generated greeting: shown in the UI and stored in history, but
   *  excluded from every model context (wire, title-gen, lore scan). 'seed' =
   *  a materialised context-pre-seeding turn (see SeedTemplateRow): body turns
   *  go on the wire as real user/assistant turns, the greeting is wire-excluded
   *  and echoed like an opener. Absent on normal messages. Non-indexed — no
   *  version bump needed for these fields. */
  kind?: 'opener' | 'seed';
  /** For `kind:'seed'` messages: 'greeting' = the optional leading persona
   *  greeting (wire-excluded, echoed to the system prompt); 'body' = an
   *  alternating user/persona turn that goes on the wire. */
  seedRole?: 'greeting' | 'body';
  streamingState: 'complete' | 'incomplete';
  /** Set when an `incomplete` message failed because a provider needed the
   *  account proxy relay and the device has no link (spec §6, Task E2).
   *  Drives StreamInterruptedFooter's "Open Server linking" affordance.
   *  Non-indexed — no version bump needed for this field. */
  failureKind?: 'proxy_unavailable';
}

/** One turn of a seed-template body: strictly alternating, user-first. */
export interface SeedTurn {
  role: 'user' | 'persona';
  text: string;
}

/** A saved, simulated conversation a user can prime a fresh chat with before
 *  sending their first real message (context pre-seeding). An optional greeting
 *  plus a strictly-alternating, user-first body. */
export interface SeedTemplateRow {
  id: string;
  name: string;
  description: string;
  nsfw: boolean;
  /** Optional leading persona greeting; null when the template is body-only. */
  greeting: string | null;
  /** Alternating user-first turns (non-indexed JSON column, like contentBlocks). */
  body: SeedTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface PillRow {
  id: string;
  messageId: string;
  kind: 'tool-call' | 'kb-injection' | 'image-result' | 'voice-expression';
  positionHint: 'inline' | 'above-text';
  status: 'pending' | 'completed' | 'failed';
  payload: unknown;
  createdAt: number;
}

export type AttachmentKind = 'image' | 'text';
export type AttachmentOrigin = 'upload' | 'generated' | 'library';
export type AttachmentState = 'active' | 'deleted';

export type ArtefactOrigin = 'generated' | 'saved-message' | 'saved-code-block';
export type ArtefactKind = 'text' | 'image';
export type ArtefactFormat = 'html' | 'markdown' | 'code' | 'svg' | 'mermaid' | 'image';

export interface ArtefactRow {
  id: string;
  /** Owner chat — cascade-deleted with the chat. */
  chatId: string;
  /** Provenance + future treasury filter. */
  personaId: string;
  /** Reserved; unused until projects exist. */
  projectId: string | null;
  origin: ArtefactOrigin;
  kind: ArtefactKind;
  format: ArtefactFormat;
  /** Display name — freely renameable. */
  title: string;
  /** Carries the extension (download + detectFormat preview); renameable. */
  fileName: string;
  mime: string;
  /** Text artefacts. */
  content: string;
  /** Normalised trim+lowercase user tags (Treasury chunk owns the UI). */
  tags: string[];
  favourite: boolean;
  createdAt: number;
  updatedAt: number;
  /** kind === 'image' — the original provider bytes, unmodified. */
  blob?: Blob;
  /** kind === 'image' — downscaled JPEG for the chat stream + Treasury. */
  thumbBlob?: Blob;
  /** WS-D §4 — persisted ref for the sealed `blob` (present once pushed; the
   *  wire row carries this, never the bytes). Non-indexed, no Dexie bump. */
  blobRef?: BlobRef;
  /** WS-D §4 — persisted ref for the sealed `thumbBlob`. */
  thumbBlobRef?: BlobRef;
  /** WS-D §4/§7.3 — durable "this blob is permanently too large for the server"
   *  sentinel, set on a `413` and synced inside the sealed record. */
  blobOversized?: true;
  /** WS-D §4 — the same terminal sentinel for the thumbnail blob. */
  thumbBlobOversized?: true;
  /** kind === 'image' — measured via createImageBitmap after fetch. */
  width?: number;
  height?: number;
  /** origin === 'generated' images — generation provenance (prompt copyable). */
  genMeta?: {
    prompt: string;
    modelRef: string;
    modelLabel: string;
    configSnapshot: ImageModelConfig;
  };
}

export interface AttachmentRow {
  id: string;
  chatId: string;
  /** null while pending (local to the chat's compose state); set to the user message id on send. */
  messageId: string | null;
  origin: AttachmentOrigin;
  kind: AttachmentKind;
  /** User-editable; ALWAYS sent on the wire. */
  fileName: string;
  mime: string;
  order: number;
  state: AttachmentState;
  createdAt: number;
  /** LWW clock for sync conflict resolution (§7.5). Stamped by the v33
   *  migration on pre-existing rows; full blob-bearing handling arrives with
   *  WS-D, but the clock lands here so WS-D needs no further migration. */
  updatedAt: number;
  /** kind === 'image' — the NORMALISED JPEG (see image-normalise.ts), the only stored copy. */
  blob?: Blob;
  /** WS-D §4 — persisted ref for the sealed `blob`; the wire row carries this,
   *  never the bytes. Non-indexed, no Dexie bump. */
  blobRef?: BlobRef;
  /** WS-D §4/§7.3 — durable oversize sentinel, set on a `413` and synced inside
   *  the sealed record so every device learns the blob is server-terminal. */
  blobOversized?: true;
  /** kind === 'text' — editable via the lightbox Source view while pending. */
  text?: string;
  /** kind === 'image' — post-normalisation dimensions. */
  width?: number;
  height?: number;
  /** kind === 'image' — substitute-vision cache, keyed by the model that produced it. */
  visionDescription?: { model: string; text: string } | null;
  /** origin === 'library' — copy-on-write reference into the knowledgebase. While
   *  `text` is unset the content is read live from this document; editing or
   *  sending freezes a snapshot into `text`. Retained for provenance after that. */
  kbRef?: { libraryId: string; documentId: string } | null;
}

export interface AvatarCrop {
  /** Pan as a fraction of the display size; 0 = centred. */
  x: number;
  y: number;
  /** Cover-scale multiplier; 1 = cover the box exactly. */
  zoom: number;
}

export interface PersonaAvatarRow {
  personaId: string; // PK, 1:1 with a persona
  /** Downscaled FULL image (not pre-cropped). Optional (WS-D §4): absent in the
   *  placeholder state (a pulled avatar whose bytes have not hydrated yet) and
   *  after removal (`blobRef: null`, the row survives so avatar sync is never
   *  bricked — the persona falls back to the monogram). */
  blob?: Blob;
  mime: string;
  width: number; // natural width of the stored image
  height: number; // natural height of the stored image
  crop: AvatarCrop;
  updatedAt: number;
  /** WS-D §4 — persisted ref for the sealed `blob`. `null` after avatar removal
   *  (the wire row carries `blobRef: null`, NEVER a tombstone — a tombstone
   *  would brick avatar sync for this personaId forever). Absent on pre-WS-D
   *  rows until the first push mints one. */
  blobRef?: BlobRef | null;
  /** WS-D §4/§7.3 — durable oversize sentinel, set on a `413`. */
  blobOversized?: true;
}

// ===== Voice audio cache (v21) =====

export interface VoiceAudioRow {
  /** Deterministic cache key produced by voiceCacheKey(). */
  key: string;
  /** Raw audio bytes from the TTS provider. */
  blob: Blob;
  /** MIME type of the audio (e.g. "audio/mpeg"). */
  mimeType: string;
  /** Blob byte size — stored separately to avoid loading the blob for LRU accounting. */
  bytes: number;
  /** Unix-ms timestamp of the last read or write — used for LRU eviction ordering. */
  lastUsedAt: number;
}

// ===== Knowledgebase (v14) =====

/** A library is a named container of documents. */
export interface LibraryRow {
  id: string;
  name: string;
  description: string;
  nsfw: boolean;
  createdAt: number;
  updatedAt: number;
}

export type EmbeddingStatus = 'pending' | 'embedding' | 'ready' | 'failed';

/** A document belongs to exactly one library; `content` is the source of truth. */
export interface DocumentRow {
  id: string;
  libraryId: string;
  title: string;
  content: string;
  embeddingStatus: EmbeddingStatus;
  embeddingError: string | null;
  chunkCount: number;
  /** Reserved for Chunk C (phrase-triggered injection). No UI in Chunk A. */
  triggerPhrases: string[];
  /** Chunk C: when true, the immediately preceding companion message is also
   *  scanned for this document's trigger phrases. Non-indexed → no version bump.
   *  Absent ⇒ false (user-message-only triggering). */
  triggerOnCompanion?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MemoryCategory = 'preference' | 'fact' | 'correction' | 'goal' | 'context';
export type MemoryJournalState = 'uncommitted' | 'committed' | 'archived';

/** One extracted memory fact. Lifecycle: uncommitted → committed → archived
 *  (the latter once a dream has folded it into a `memoryBody` version). */
export interface MemoryJournalRow {
  id: string;
  personaId: string;
  content: string;
  category: MemoryCategory | null;
  state: MemoryJournalState;
  isCorrection: boolean;
  createdAt: number;
  committedAt: number | null;
  autoCommitted: boolean;
  archivedByDreamId: string | null;
  /** Chatsune origin marker (memory import idempotency, Plan 3). Absent for natives. */
  importedFrom?: string;
}

export type MemoryBodySource = 'dream' | 'manual' | 'import';

/** A consolidated, free-prose memory body version for one persona. Max 5 kept. */
export interface MemoryBodyRow {
  id: string;
  personaId: string;
  content: string;
  tokenCount: number;
  version: number;
  entriesProcessed: number;
  createdAt: number;
  source: MemoryBodySource;
}

export type CompactionTrigger = 'auto' | 'manual' | 'overflow';

/** A saved snapshot of what was known before a context compaction. Stored so the
 *  summary can be re-injected on every subsequent turn, and so the tail slice can
 *  be reconstructed without re-loading dropped messages. */
export interface CompactionCheckpointRow {
  /** Stable uuidv7 primary key. */
  id: string;
  /** Owner chat — cascade-deleted with the chat. Indexed for fast per-chat lookup. */
  chatId: string;
  /** Unix-ms creation timestamp. Indexed for time-ordered queries. */
  createdAt: number;
  /** The model that produced the summary (provenance / audit trail). */
  modelId: string;
  /** Free-prose Markdown summary of the compacted portion. */
  summaryMarkdown: string;
  /** Id of the newest message included in the compacted portion. */
  lastMessageIdBefore: string;
  /** Id of the first message retained in the live tail. */
  tailStartMessageId: string;
  /** Estimated token count of the compacted portion (pre-compaction). */
  tokensBefore: number;
  /** Estimated token count of the summary (post-compaction). */
  tokensAfter: number;
  /** Estimated token count of the live tail at compaction time. */
  tailTokenCount: number;
  /** Id of the preceding checkpoint, or null when this is the first. */
  prevCheckpointId: string | null;
  /** What triggered the compaction. */
  trigger: CompactionTrigger;
}

// ===== Sync engine rows (v33, WS-C — spec §4) =====

/** An outbound change awaiting seal + push. No payload — sealing reads the
 *  live row at drain time, so queued edits of one key coalesce for free.
 *
 *  WS-D §5: the op union gains `blob-put`/`blob-delete` for the binary channel.
 *  A blob op carries the owning record's sync `key` (so cascades and coalescing
 *  group with the record naturally) plus the specific `blobId` it acts on. */
export interface SyncOutboxRow {
  seq?: number;
  collection: SyncCollection;
  key: string;
  op: 'upsert' | 'delete' | 'blob-put' | 'blob-delete';
  /** WS-D §5 — set for `blob-put`/`blob-delete` only; the blob the op acts on. */
  blobId?: string;
  enqueuedAt: number;
  /**
   * Backfill spec §3.4 (Larissa L-6): the server refused this record terminally
   * (`record_too_large`). Excluded from every drain phase and from the backfill
   * remainder, so a doomed record can neither hot-loop nor wedge completion.
   * Swept by `applyOk` when a later (smaller) edit of the same key lands.
   */
  terminal?: true;
}

/** Per-row CAS metadata: the last server rev seen and the locally computed
 *  hash of the last sealed ciphertext (§7.0 echo shortcut). */
export interface SyncRowMeta {
  collection: SyncCollection;
  key: string;
  rev: number;
  ciphertextHash: string;
  /**
   * Task B9 (Finding #7): a LOCAL-ONLY, deterministic content fingerprint of
   * the row's pre-seal wire form (never the nonce-dependent `ciphertextHash`,
   * and NEVER sent to the server — a plaintext hash is content-correlatable,
   * unlike a hash of already-public ciphertext bytes). Read and compared by
   * the reconnect reconciliation pass (`sync/reconcile.ts`) to detect a row
   * whose content changed via the `deferWhenOffline` no-outbox path, and kept
   * FRESH at every convergence point so that comparison stays meaningful: the
   * reconciliation pass itself (bootstrap + divergence stamps), the push-ack
   * path (`sync/worker.ts`'s `applyOk`, stamped to exactly what was sealed),
   * and the pull-apply path (`sync/apply.ts`, stamped to the just-written
   * local row). Absent on every row that predates this field or has never been
   * through any of the above — reads as "no baseline yet", never as
   * "unchanged".
   */
  localContentHash?: string;
}

/** The singleton sync-engine state row. */
export interface SyncStateRow {
  id: 'state';
  epoch: string | null;
  watermarkRev: number;
  lastSyncAt: number | null;
  pulling: { pages: number; startedAt: number } | null;
  attention: SyncAttention | null;
  /** §3.1 — set by the late-link path; the worker hands off to the backfill pump. */
  backfillPending?: boolean;
  /** §3.7 — one-off snapshot of rows to upload, counted at first pump run. */
  backfillTotal?: number | null;
  /** §3.7 — rows enqueued-and-drained so far. */
  backfillDone?: number | null;
  /**
   * The linked account's `server_user_id`, stamped by `resetEngineStateForNewLink`
   * at link time. Compared against the currently linked account at cycle start
   * (Task 4) to force a deterministic reset on a server switch, rather than
   * relying solely on the runtime epoch mismatch. Non-indexed — no `stores()`
   * change, no Dexie version bump; absent on legacy rows (`undefined` reads as
   * "unknown identity", never as a mismatch).
   */
  linkedServerUserId?: string;
  /** Highest pulled-but-suppressed rev per `collection:key` (audit #5): consumed
   *  by the fast-Undo watermark rewind, cleared on drain-ack/recovery/relink. */
  suppressedRevs?: Record<string, number>;
  /** The per-link engine generation (audit #8): bumped by every engine reset so
   *  an in-flight drain/pull from the previous link can be recognised and its
   *  write-backs discarded. Non-indexed; absent on legacy rows (reads as 0). */
  linkGeneration?: number;
  /**
   * Task B9 (Finding #7): when the corpus-wide reconnect reconciliation pass
   * last completed a FULL scan, `Date.now()` epoch ms. The coarse throttle that
   * keeps the pass from re-hashing the whole corpus on every cycle trigger — a
   * scan aborted mid-way (offline/locked/relink) does NOT stamp this, so the
   * next eligible cycle retries the full scan rather than losing the
   * unreached tail until the interval elapses again. Non-indexed; absent on
   * legacy rows (reads as "never run").
   */
  lastReconcileAt?: number | null;
}

/** A pulled-tombstone row held for its 30-day grace window (§7.3). */
export interface TrashRow {
  id: string;
  collection: SyncCollection;
  key: string;
  row: unknown;
  deletedAt: number;
  purgeAt: number;
  // §3.3 — grouping metadata that decides which card this row displays under.
  entityKind: 'persona' | 'chat' | 'memory' | 'library' | 'document' | 'chatChild';
  rootGroup: string; // `persona:<id>` | `library:<id>` | `<collection>:<key>` fallback
  parentRef: { field: string; id: string } | null; // e.g. {field:'personaId', id:<originalId>}
}

/** §3.9 — a durable, server-authoritative record that a key's identity is dead (the permanent H-1 anchor). */
export interface DeadKeyRow {
  id: string;
  collection: SyncCollection;
  key: string;
  diedAt: number;
}

/**
 * §3.10 L-C — minimal grouping-metadata derivation from a collection + its row
 * snapshot: parent ref from the snapshot's own foreign key, rootGroup from it when
 * present, else a top-level `<collection>:<key>` fallback (ungrouped card).
 */
export function deriveLegacyTrashMeta(
  collection: SyncCollection,
  key: string,
  snapshot: unknown,
): {
  entityKind: TrashRow['entityKind'];
  rootGroup: string;
  parentRef: { field: string; id: string } | null;
} {
  const s = (snapshot ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  switch (collection) {
    case 'personas':
      return { entityKind: 'persona', rootGroup: `persona:${key}`, parentRef: null };
    case 'chats': {
      const pid = str(s.personaId);
      return pid
        ? {
            entityKind: 'chat',
            rootGroup: `persona:${pid}`,
            parentRef: { field: 'personaId', id: pid },
          }
        : { entityKind: 'chat', rootGroup: `chats:${key}`, parentRef: null };
    }
    case 'memoryJournal':
    case 'memoryBody': {
      const pid = str(s.personaId);
      return pid
        ? {
            entityKind: 'memory',
            rootGroup: `persona:${pid}`,
            parentRef: { field: 'personaId', id: pid },
          }
        : { entityKind: 'memory', rootGroup: `${collection}:${key}`, parentRef: null };
    }
    case 'libraries':
      return { entityKind: 'library', rootGroup: `library:${key}`, parentRef: null };
    case 'documents': {
      const lid = str(s.libraryId);
      return lid
        ? {
            entityKind: 'document',
            rootGroup: `library:${lid}`,
            parentRef: { field: 'libraryId', id: lid },
          }
        : { entityKind: 'document', rootGroup: `documents:${key}`, parentRef: null };
    }
    case 'messages':
    case 'pills':
    case 'compactionCheckpoints': {
      const cid = str(s.chatId);
      return cid
        ? {
            entityKind: 'chatChild',
            rootGroup: `chats:${cid}`,
            parentRef: { field: 'chatId', id: cid },
          }
        : { entityKind: 'chatChild', rootGroup: `${collection}:${key}`, parentRef: null };
    }
    default:
      // Only the four trashable families + their children ever reach trash; a
      // truly unexpected collection gets an ungrouped top-level card.
      return { entityKind: 'chatChild', rootGroup: `${collection}:${key}`, parentRef: null };
  }
}

/** Engine attention state (spec §11.1/§11.3). Downstream tasks consume this union. */
export type SyncAttention =
  | { kind: 'quota_exceeded'; usedBytes: number; quotaBytes: number }
  | { kind: 'record_too_large' }
  | { kind: 'delete_rate_limited' }
  | { kind: 'tombstone_threshold'; count: number }
  | { kind: 'recovery_paused' }
  | { kind: 'blob_reupload_threshold'; bytes: number; count: number }
  | { kind: 'tamper' }
  | { kind: 'auth_degraded' }
  /** Pre-test analysis #8 — consecutive whole-cycle transport failures while the
   *  server is believed reachable; cleared by the next completed cycle. */
  | { kind: 'transport_failing' };

// ===== Dexie subclass =====

export class ClientDataDb extends Dexie {
  settings!: Table<SettingsRow, 1>;
  providers!: Table<ProviderRow, string>;
  mindspaces!: Table<MindspaceRow, string>;
  personas!: Table<PersonaRow, string>;
  chats!: Table<ChatRow, string>;
  messages!: Table<MessageRow, string>;
  pills!: Table<PillRow, string>;
  personaAvatars!: Table<PersonaAvatarRow, string>;
  attachments!: Table<AttachmentRow, string>;
  artefacts!: Table<ArtefactRow, string>;
  libraries!: Table<LibraryRow, string>;
  documents!: Table<DocumentRow, string>;
  mcpServers!: Table<McpServerRow, string>;
  voiceAudio!: Table<VoiceAudioRow, string>;
  memoryJournal!: Table<MemoryJournalRow, string>;
  memoryBody!: Table<MemoryBodyRow, string>;
  compactionCheckpoints!: Table<CompactionCheckpointRow, string>;
  seedTemplates!: Table<SeedTemplateRow, string>;
  syncOutbox!: Table<SyncOutboxRow, number>;
  syncRows!: Table<SyncRowMeta, [string, string]>;
  syncState!: Table<SyncStateRow, string>;
  trash!: Table<TrashRow, string>;
  deadKeys!: Table<DeadKeyRow, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });

    this.version(2)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill new SettingsRow.userFont — default 'serif' per Decision 28.
        const settings = await tx.table('settings').get(1);
        if (settings) {
          await tx.table('settings').update(1, { userFont: 'serif' });
        }
        // Backfill new PersonaRow fields — Decision 26.
        const personas = await tx.table('personas').toArray();
        for (const p of personas) {
          await tx.table('personas').update(p.id, {
            tagline: '',
            temperature: 0.85,
            adultPersona: false,
          });
        }
      });

    this.version(3)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.userTexture from the default mindspace's texture,
        // falling back to 'cloudy' if the mindspace row is absent.
        const settings = await tx.table('settings').get(1);
        if (settings) {
          const defaultMs = await tx.table('mindspaces').get(settings.defaultMindspaceId);
          const seedTexture = defaultMs?.texture ?? 'cloudy';
          await tx.table('settings').update(1, { userTexture: seedTexture });
        }
        // Backfill PersonaRow.textureOverride — null means "inherit from user default".
        const personas = await tx.table('personas').toArray();
        for (const p of personas) {
          await tx.table('personas').update(p.id, { textureOverride: null });
        }
      });

    this.version(4)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.displayName — default '' means "use the username".
        const settings = await tx.table('settings').get(1);
        if (settings && typeof settings.displayName !== 'string') {
          await tx.table('settings').update(1, { displayName: '' });
        }
      });

    this.version(5)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // Backfill SettingsRow.adultMode. Default is 'nsfw' per spec §2
        // Decision 2 — SFW is treated as the special case, not the default.
        // This setting is device-local and must be excluded from any future
        // sync mechanism.
        const settings = await tx.table('settings').get(1);
        if (settings && typeof settings.adultMode !== 'string') {
          await tx.table('settings').update(1, { adultMode: 'nsfw' });
        }
      });

    this.version(6)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        // ChatRow.draftInput — Phase 3 §6.4 Cockpit-Input persistence.
        const chats = await tx.table('chats').toArray();
        for (const c of chats) {
          if (typeof c.draftInput !== 'string') {
            await tx.table('chats').update(c.id, { draftInput: '' });
          }
        }
      });

    // v7 — Phase 4 chain-of-thought display. Schema-structurally identical
    // to v6: `contentBlocks` is a non-indexed JSON column and accepts the
    // widened ContentBlock union (now including `{type:'reasoning',text}`)
    // without any index changes. The bump is a code-capability marker:
    // "this build knows about reasoning blocks". No upgrade callback needed.
    this.version(7).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });

    // Version 8 — Slice 2: personas gain a non-indexed `canonicalId`. Clean
    // break: rows from v7 have no canonicalId; the editor treats that as
    // "model not set" and prompts a re-pick. No upgrade callback needed.
    this.version(8).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });

    // Version 9 — system-prompt builder v2. Rename the settings "unlocker"
    // field and give personas a `chatsundereTonality` toggle (default on).
    this.version(9)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            s.globalInstructions = s.globalUnlockerPrompt ?? '';
            s.globalUnlockerPrompt = undefined;
          });
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            p.chatsundereTonality = true;
          });
      });

    // Version 10 — persona-settings: per-persona context window + avatars.
    // personas gain a non-indexed `contextWindow` (backfilled null); a new
    // `personaAvatars` table holds the downscaled image + crop metadata.
    this.version(10)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
        personaAvatars: 'personaId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            p.contextWindow = null;
          });
      });

    // Version 11 — web-interfacing integration spine. Settings gain a
    // non-indexed `webInterfacing` block selecting the web search/fetch
    // backends (both null until the user configures them).
    this.version(11)
      .stores({
        settings: 'id',
        providers: 'id, templateId, enabled',
        mindspaces: 'id, builtIn, displayName',
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
        messages: 'id, chatId, [chatId+createdAt]',
        pills: 'id, messageId',
        personaAvatars: 'personaId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            s.webInterfacing = { search: null, fetch: null };
          });
      });

    // Version 12 — user attachments. A new `attachments` table holds uploaded
    // images and text files, joined to a user message by messageId (null while
    // pending). Settings gain `substituteVisionModel` for the global vision
    // fallback (backfilled null for existing rows).
    this.version(12)
      .stores({
        attachments: 'id, chatId, messageId, [chatId+messageId]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((row: SettingsRow) => {
            if (row.substituteVisionModel === undefined) row.substituteVisionModel = null;
          });
      });

    // Version 13 — artefacts treasury. A new `artefacts` table holds text and
    // image artefacts generated or saved by the user, indexed for fast lookup
    // by chat, persona, and favourite status.
    this.version(13).stores({
      artefacts: 'id, chatId, personaId, favourite, [chatId+createdAt]',
    });

    // Version 14 — knowledgebase foundation. Two new tables: `libraries`
    // (named document containers) and `documents` (Markdown content + embedding
    // status). Chunk vectors live in the separate embeddings vector store, not
    // here. Fresh tables → no upgrade callback.
    this.version(14).stores({
      libraries: 'id, name, nsfw',
      documents: 'id, libraryId, embeddingStatus, [libraryId+createdAt]',
    });

    // Version 15 — knowledgebase Chunk B (retrieval). Personas and chats gain a
    // non-indexed `libraryIds` array binding them to knowledge libraries.
    this.version(15)
      .stores({
        personas: 'id, providerId',
        chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (!Array.isArray(p.libraryIds)) p.libraryIds = [];
          });
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            if (!Array.isArray(c.libraryIds)) c.libraryIds = [];
          });
      });

    // Version 16 — ask_expert. Settings gain a global `expertModel` ref; personas
    // gain `askExpertDefault` (the default state of the per-chat runtime toggle).
    this.version(16)
      .stores({
        settings: 'id',
        personas: 'id, providerId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.expertModel === undefined) s.expertModel = null;
          });
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.askExpertDefault !== 'boolean') p.askExpertDefault = false;
          });
      });

    // Version 17 — expert web access. Settings gain an independent `expertWeb`
    // block selecting the expert uplink's own web search/fetch backends + depth.
    // null backends mean "auto" (resolved to exa+neural when available).
    this.version(17)
      .stores({ settings: 'id' })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.expertWeb === undefined) {
              s.expertWeb = { search: null, fetch: null, searchTierId: null };
            }
          });
      });

    // Version 18 — MCP client. New `mcpServers` table; personas gain
    // `mcpOverrides` (tri-state per server; unset → the server default).
    this.version(18)
      .stores({
        mcpServers: 'id, createdAt',
        personas: 'id, providerId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.mcpOverrides !== 'object' || p.mcpOverrides === null) p.mcpOverrides = {};
          });
      });

    // Version 19 — TTI image generation. Settings gain `imageGeneration`
    // (primary + NSFW model slots, spec 2026-06-09).
    this.version(19)
      .stores({ settings: 'id' })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.imageGeneration === undefined) {
              s.imageGeneration = { primary: null, nsfw: null };
            }
          });
      });

    // Version 20 — roleplay mode & user greeting. Personas gain the roleplay
    // toggle, narration perspective, and greeting fields (spec 2026-06-11).
    this.version(20)
      .stores({ personas: 'id, providerId' })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.roleplay !== 'boolean') p.roleplay = false;
            if (p.narration !== 'first' && p.narration !== 'third') p.narration = 'first';
            if (typeof p.greetingEnabled !== 'boolean') p.greetingEnabled = false;
            if (typeof p.greetingInstructions !== 'string') p.greetingInstructions = '';
          });
      });

    // Version 21 — voice playback core. Settings gain a `voiceMode` toggle;
    // personas gain `voice` and `narratorVoice` TTS voice-id slots (both null
    // until the user configures them). A new `voiceAudio` table persists the
    // LRU audio cache (key, blob, mimeType, bytes, lastUsedAt).
    this.version(21)
      .stores({ voiceAudio: 'key, lastUsedAt' })
      .upgrade(async (tx) => {
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            if (s.voiceMode !== 'paragraph' && s.voiceMode !== 'sentence')
              s.voiceMode = 'paragraph';
          });
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.voice !== 'string') p.voice = null;
            if (typeof p.narratorVoice !== 'string') p.narratorVoice = null;
          });
      });

    // Version 22 — dictation/STT. Settings gain the VAD sensitivity preset,
    // the redemption (silence-tolerance) window and the auto-send toggle.
    this.version(22).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (s.dictationSensitivity !== 'low' && s.dictationSensitivity !== 'high')
            s.dictationSensitivity = 'medium';
          if (typeof s.dictationRedemptionMs !== 'number') s.dictationRedemptionMs = 1_728;
          if (typeof s.dictationAutoSend !== 'boolean') s.dictationAutoSend = false;
        });
    });

    // Version 23 — xAI voice onboarding. Settings gain the two voice slot
    // refs; null means the curated auto-default order resolves at runtime.
    this.version(23).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.ttsOffering !== 'string' && s.ttsOffering !== null) s.ttsOffering = null;
          if (typeof s.sttOffering !== 'string' && s.sttOffering !== null) s.sttOffering = null;
        });
    });

    // Version 24 — auto-read-aloud. Settings gain the auto-read-aloud switch and
    // the one-shot stop-hint flag; both default false for existing installs.
    this.version(24).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.autoReadAloud !== 'boolean') s.autoReadAloud = false;
          if (typeof s.voiceStopHintSeen !== 'boolean') s.voiceStopHintSeen = false;
        });
    });

    // Version 25 — spectrum analyser. Settings gain enable/style/opacity/barCount;
    // existing installs get the spec defaults (analyser on, soft, 0.5, 24 bars).
    this.version(25).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.spectrumEnabled !== 'boolean') s.spectrumEnabled = true;
          if (
            s.spectrumStyle !== 'sharp' &&
            s.spectrumStyle !== 'soft' &&
            s.spectrumStyle !== 'glow'
          ) {
            s.spectrumStyle = 'soft';
          }
          if (typeof s.spectrumOpacity !== 'number') s.spectrumOpacity = 0.5;
          if (typeof s.spectrumBarCount !== 'number') s.spectrumBarCount = 24;
        });
    });

    // Version 26 — TTS high-pass cleanup. Settings gain `ttsHighpass`
    // (behaviour-axis, global), defaulting to the 'auto' recommendation.
    this.version(26).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((s: Partial<SettingsRow>) => {
          if (
            s.ttsHighpass !== 'auto' &&
            s.ttsHighpass !== 'off' &&
            s.ttsHighpass !== 50 &&
            s.ttsHighpass !== 100
          )
            s.ttsHighpass = 'auto';
        });
    });

    // Version 27 — long-term memory. Adds two object stores (memoryJournal,
    // memoryBody) and backfills the optional per-persona / per-chat memory
    // fields on existing rows for tidiness (reads still default via `?? `).
    this.version(27)
      .stores({
        memoryJournal: 'id, personaId, [personaId+state], [personaId+createdAt]',
        memoryBody: 'id, personaId, [personaId+version]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.useMemory !== 'boolean') p.useMemory = true;
            if (typeof p.memoryInstructions !== 'string') p.memoryInstructions = '';
            if (typeof p.lastViewedMemoryBodyVersion !== 'number')
              p.lastViewedMemoryBodyVersion = 0;
            if (typeof p.memoryIntroShown !== 'boolean') p.memoryIntroShown = false;
          });
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            if (c.lastExtractedMessageId === undefined) c.lastExtractedMessageId = null;
          });
      });

    // Version 28 — Circle LRU sort. Backfills `lastInteractionAt` on existing
    // personas: set to the max `lastMessageAt` across the persona's chats, or
    // fall back to `createdAt` when the persona has no chats.
    // `lastInteractionAt` is NOT indexed — no schema change is needed.
    this.version(28)
      .stores({
        memoryJournal: 'id, personaId, [personaId+state], [personaId+createdAt]',
        memoryBody: 'id, personaId, [personaId+version]',
      })
      .upgrade(async (tx) => {
        const personas = await tx.table('personas').toArray();
        for (const persona of personas) {
          const chats = await tx.table('chats').where('personaId').equals(persona.id).toArray();
          const maxChat = chats.reduce(
            (max: number, c: { lastMessageAt?: number }) => Math.max(max, c.lastMessageAt ?? 0),
            0,
          );
          await tx.table('personas').update(persona.id, {
            lastInteractionAt: maxChat > 0 ? maxChat : persona.createdAt,
          });
        }
      });

    // Version 29 — compact and continue. Adds the compactionCheckpoints store and
    // backfills the optional per-chat pointer/flag for tidiness (reads default via `??`).
    this.version(29)
      .stores({
        compactionCheckpoints: 'id, chatId, createdAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            if (c.activeCompactionId === undefined) c.activeCompactionId = null;
            if (typeof c.compactionToastShown !== 'boolean') c.compactionToastShown = false;
          });
      });

    // Version 30 — MCP local-network routing. mcpServers gain `allowDirect`
    // (user intent; off → proxy-only). Backfilled from the row's resolved
    // `routing`: a server already resolved to direct keeps working.
    this.version(30).upgrade(async (tx) => {
      await tx
        .table('mcpServers')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.allowDirect !== 'boolean') s.allowDirect = s.routing === 'direct';
        });
    });

    // Version 31 — screen effects. The settings singleton gains
    // `screenEffectsEnabled` (no index change). Backfilled to `true` so existing
    // installs default to having the flourish available.
    this.version(31).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((row: Record<string, unknown>) => {
          if (typeof row.screenEffectsEnabled !== 'boolean') row.screenEffectsEnabled = true;
        });
    });

    // Version 32 — context pre-seeding. A new global `seedTemplates` store
    // (saved primer conversations). New empty table → no upgrade callback. The
    // MessageRow.kind 'seed' / seedRole additions are non-indexed JSON fields,
    // so they need no migration.
    this.version(32).stores({ seedTemplates: 'id, createdAt, nsfw' });

    // Version 33 — sync engine (this version is RESERVED for WS-C). Four new
    // tables; the upgrade stamps updatedAt on the LWW-keyed rows lacking it so
    // WS-D needs no further migration.
    this.version(33)
      .stores({
        syncOutbox: '++seq, [collection+key]',
        syncRows: '[collection+key]',
        syncState: 'id',
        trash: 'id, purgeAt',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        for (const table of ['chats', 'messages', 'mindspaces', 'attachments'] as const) {
          await tx
            .table(table)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              if (typeof row.updatedAt !== 'number') row.updatedAt = now;
            });
        }
      });

    // Version 34 — universal trashcan: grouping metadata on trash rows (+ a
    // rootGroup index for grouped queries) and a durable deadKeys store (the
    // permanent H-1 anchor). Backfill existing trash rows and seed deadKeys.
    this.version(34)
      .stores({ trash: 'id, purgeAt, rootGroup', deadKeys: 'id, collection' })
      .upgrade(async (tx) => {
        const trash = tx.table('trash');
        const dead = tx.table('deadKeys');
        await trash.toCollection().modify((t: Record<string, unknown>) => {
          const meta = deriveLegacyTrashMeta(
            t.collection as SyncCollection,
            t.key as string,
            t.row,
          );
          t.entityKind = meta.entityKind;
          t.rootGroup = meta.rootGroup;
          t.parentRef = meta.parentRef;
        });
        // Seed dead-key markers from existing trash keys — their death is
        // server-authoritative and must outlive the 30-day snapshot (§3.9).
        const rows = await trash.toArray();
        for (const t of rows as Array<Record<string, unknown>>) {
          const collection = t.collection as SyncCollection;
          const key = t.key as string;
          const deletedAt = typeof t.deletedAt === 'number' ? t.deletedAt : 0;
          await dead.put({ id: `${collection}:${key}`, collection, key, diedAt: deletedAt });
        }
      });

    // Version 35 — provider identity: a provider row's `id` value becomes its
    // `templateId` so cross-device sync converges on one row per template (spec
    // §5). Dedup each templateId group to a deterministic survivor, re-insert it
    // under `id = templateId`, and stash its old id as `keySlot` so the sealed
    // apiKey (bound to `provider/<old id>/api-key`) opens unchanged — no re-seal,
    // no MasterKey needed. Idempotent: a row already keyed by its templateId is
    // simply re-put with its keySlot preserved. Stores are unchanged; the bump
    // exists only to run this data rewrite.
    //
    // `PersonaRow.providerId` holds a provider row id too (historically a uuid),
    // and it is the only other table referencing one — the rekey below deletes
    // every old-uuid row, so every persona pointing at one must be remapped to
    // its new templateId here, in the same transaction.
    this.version(35)
      .stores({ providers: 'id, templateId, enabled' })
      .upgrade(async (tx) => {
        const table = tx.table('providers');
        const rows = (await table.toArray()) as ProviderRow[];
        // Total map over every pre-migration row (both winners and losers of the
        // dedup below) — a persona may point at either, and both collapse to the
        // same templateId.
        const oldIdToTemplate = new Map<string, string>();
        for (const r of rows) oldIdToTemplate.set(r.id, r.templateId);
        const byTemplate = new Map<string, ProviderRow[]>();
        for (const r of rows) {
          const group = byTemplate.get(r.templateId) ?? [];
          group.push(r);
          byTemplate.set(r.templateId, group);
        }
        for (const [templateId, group] of byTemplate) {
          const survivor = pickProviderSurvivor(group);
          for (const r of group) await table.delete(r.id);
          await table.put({
            ...survivor,
            id: templateId,
            keySlot: survivor.keySlot ?? survivor.id,
          });
        }
        const personas = (await tx.table('personas').toArray()) as PersonaRow[];
        for (const p of personas) {
          const mapped = oldIdToTemplate.get(p.providerId);
          if (mapped && mapped !== p.providerId) {
            await tx.table('personas').update(p.id, { providerId: mapped });
          }
        }
      });

    // Version 36 — built-in mindspace identity: built-ins move from per-device
    // uuidv7 ids to the deterministic slugs in BUILT_IN_MINDSPACES, so the synced
    // reference fields converge across devices (pre-test-analysis #5; the v35
    // provider-identity pattern). Rekey the seeded rows and remap every
    // referencing store in the same transaction: settings.defaultMindspaceId,
    // personas.mindspaceId, chats.resolvedMindspaceId, and the row snapshots
    // inside trash entries for personas/chats (a trashcan restore must not
    // resurrect a dead uuid reference). Unknown ids (historic imports) pass
    // through untouched. Idempotent: slug-keyed rows are left alone. Stores are
    // unchanged; the bump exists only to run this data rewrite.
    this.version(36)
      .stores({ mindspaces: 'id, builtIn, displayName' })
      .upgrade(async (tx) => {
        const slugByName = new Map(BUILT_IN_MINDSPACES.map((b) => [b.displayName, b.id]));
        const table = tx.table('mindspaces');
        const rows = (await table.toArray()) as MindspaceRow[];
        const oldIdToSlug = new Map<string, string>();
        for (const r of rows) {
          if (r.builtIn !== true) continue;
          const slug = slugByName.get(r.displayName);
          if (slug === undefined || r.id === slug) continue;
          oldIdToSlug.set(r.id, slug);
          await table.delete(r.id);
          await table.put({ ...r, id: slug });
        }
        if (oldIdToSlug.size === 0) return;
        const remap = (id: unknown): string | null =>
          typeof id === 'string' ? (oldIdToSlug.get(id) ?? null) : null;
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            const mapped = remap(s.defaultMindspaceId);
            if (mapped !== null) s.defaultMindspaceId = mapped;
          });
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const mapped = remap(p.mindspaceId);
            if (mapped !== null) p.mindspaceId = mapped;
          });
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            const mapped = remap(c.resolvedMindspaceId);
            if (mapped !== null) c.resolvedMindspaceId = mapped;
          });
        await tx
          .table('trash')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            if (t.collection !== 'personas' && t.collection !== 'chats') return;
            const snapshot = t.row;
            if (typeof snapshot !== 'object' || snapshot === null) return;
            const snap = snapshot as Record<string, unknown>;
            const mappedPersona = remap(snap.mindspaceId);
            if (mappedPersona !== null) snap.mindspaceId = mappedPersona;
            const mappedChat = remap(snap.resolvedMindspaceId);
            if (mappedChat !== null) snap.resolvedMindspaceId = mappedChat;
          });
      });
  }
}

let dbHandle: ClientDataDb | null = null;
let pending: Promise<ClientDataDb> | null = null;

/**
 * Open the user-client data DB and seed built-in mindspaces + settings
 * singleton on first launch. Idempotent — re-running with seeded state
 * is a no-op.
 */
export function openClientDataDb(): Promise<ClientDataDb> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (pending) return pending;
  pending = (async () => {
    const db = new ClientDataDb();
    await db.open();
    await seedBuiltinsIfNeeded(db);
    dbHandle = db;
    return db;
  })().finally(() => {
    // Clear the in-flight ref whether the promise resolved or rejected,
    // so a transient failure (quota, blocked, etc.) is recoverable on
    // a subsequent call instead of cementing the rejection.
    pending = null;
  });
  return pending;
}

export function getClientDataDb(): ClientDataDb {
  if (!dbHandle)
    throw new Error('client-data DB not opened — call openClientDataDb() during boot first');
  return dbHandle;
}

/**
 * Release the permanent module-level Dexie handle without deleting any data.
 * Used by the complete-wipe (`wipeDevice`) so the subsequent
 * `Dexie.delete(DB_NAME)` sees no open connection and can run to completion
 * instead of tripping the browser's `onblocked` path. Clearing `pending` too
 * prevents an in-flight `openClientDataDb()` from resurrecting the handle after
 * we have closed it.
 */
export function closeClientDataDb(): void {
  dbHandle?.close();
  dbHandle = null;
  pending = null;
}

/**
 * Reset the in-process handle. Used by tests to force re-open against
 * fake-indexeddb between cases. `keepData: true` preserves the underlying
 * IndexedDB content (so we can prove seeding is idempotent across opens).
 */
export async function _resetClientDataDbForTests(opts: { keepData?: boolean } = {}): Promise<void> {
  if (dbHandle) {
    dbHandle.close();
    dbHandle = null;
  }
  pending = null;
  if (!opts.keepData) {
    await Dexie.delete(DB_NAME);
  }
}

// ===== Seeding =====

/**
 * The seven built-in mindspaces. `id` is a deterministic, self-describing slug —
 * identical on every device — so the synced reference fields
 * (`settings.defaultMindspaceId`, `personas.mindspaceId`,
 * `chats.resolvedMindspaceId`) converge across devices (the v35 provider-identity
 * pattern; pre-test-analysis #5). Ids are immutable identity: mutable attributes
 * (accent, texture) deliberately stay out of the slug.
 */
const BUILT_IN_MINDSPACES: ReadonlyArray<{ id: string; displayName: string; accent: string }> = [
  { id: 'mindspace-builtin-crimson', displayName: 'Crimson', accent: '#b33a5e' },
  { id: 'mindspace-builtin-aurum', displayName: 'Aurum', accent: '#c9a84c' },
  { id: 'mindspace-builtin-verdan', displayName: 'Verdan', accent: '#6aa97a' },
  { id: 'mindspace-builtin-azuro', displayName: 'Azuro', accent: '#4a7eb3' },
  { id: 'mindspace-builtin-indigaut', displayName: 'Indigaut', accent: '#5d4e9e' },
  { id: 'mindspace-builtin-violetta', displayName: 'Violetta', accent: '#9a5bb8' },
  { id: 'mindspace-builtin-rosari', displayName: 'Rosari', accent: '#c97a99' },
];

async function seedBuiltinsIfNeeded(db: ClientDataDb): Promise<void> {
  const existingSettings = await db.settings.get(1);
  const existingMindspaces = await db.mindspaces.toArray();
  const existingNames = new Set(existingMindspaces.map((m) => m.displayName));

  // Deliberately displayName-keyed, not id-keyed: a pre-v36 DB still holds the
  // built-ins under per-device uuid ids until the rekey migration runs, and an
  // id-keyed check would double-seed there.
  const missingBuiltins = BUILT_IN_MINDSPACES.filter((b) => !existingNames.has(b.displayName));
  const staleVerdanOrAzuro = existingMindspaces.filter(
    (m) =>
      (m.displayName === 'Verdan' && m.palette.accent !== '#6aa97a') ||
      (m.displayName === 'Azuro' && m.palette.accent !== '#4a7eb3'),
  );

  if (existingSettings && missingBuiltins.length === 0 && staleVerdanOrAzuro.length === 0) {
    return; // already at Phase-2 state — no-op
  }

  const now = Date.now();
  await db.transaction('rw', db.mindspaces, db.settings, async () => {
    // Add any missing built-ins
    if (missingBuiltins.length > 0) {
      await db.mindspaces.bulkAdd(
        missingBuiltins.map((b) => buildMindspace(b.id, b.displayName, b.accent, now)),
      );
    }
    // Refresh stale palettes for Verdan / Azuro (preserving id + texture + builtIn flag)
    for (const stale of staleVerdanOrAzuro) {
      const finalised = BUILT_IN_MINDSPACES.find((b) => b.displayName === stale.displayName);
      if (!finalised) continue;
      const refreshed = buildMindspace(stale.id, stale.displayName, finalised.accent, now);
      await db.mindspaces.put({ ...refreshed, texture: stale.texture });
    }
    // Seed the settings singleton if it doesn't exist
    if (!existingSettings) {
      const aurum = await db.mindspaces.get('mindspace-builtin-aurum');
      const aurumId =
        aurum?.id ?? (await db.mindspaces.toCollection().first())?.id ?? 'mindspace-builtin-aurum';
      await db.settings.add({
        id: 1,
        displayName: '',
        globalInstructions: '',
        globalAboutMe: '',
        defaultMindspaceId: aurumId,
        userTexture: 'cloudy',
        animationsEnabled: true,
        adultMode: 'nsfw',
        corsProxy: null,
        webInterfacing: { search: null, fetch: null },
        expertWeb: { search: null, fetch: null, searchTierId: null },
        substituteVisionModel: null,
        expertModel: null,
        artefactExpertModel: null,
        imageGeneration: { primary: null, nsfw: null },
        voiceMode: 'paragraph',
        dictationSensitivity: 'medium',
        dictationRedemptionMs: 1_728,
        dictationAutoSend: false,
        ttsOffering: null,
        sttOffering: null,
        autoReadAloud: false,
        voiceStopHintSeen: false,
        spectrumEnabled: true,
        spectrumStyle: 'soft',
        spectrumOpacity: 0.5,
        spectrumBarCount: 24,
        screenEffectsEnabled: true,
        ttsHighpass: 'auto',
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

function buildMindspace(
  id: string,
  displayName: string,
  accentHex: string,
  now: number,
): MindspaceRow {
  const accentRgb = hexToRgb(accentHex);
  const textBase = textRgbForAccent(accentHex);
  return {
    id,
    displayName,
    palette: {
      bg: '#0a0a0a',
      surfaceBase: 'rgba(255,255,255,0.025)',
      surfaceRaised: 'rgba(255,255,255,0.04)',
      surfaceInput: 'rgba(0,0,0,0.3)',
      accent: accentHex,
      accentSubtle: `rgba(${accentRgb},0.06)`,
      accentBorder: `rgba(${accentRgb},0.15)`,
      accentBorderActive: `rgba(${accentRgb},0.35)`,
      accentGlow: `rgba(${accentRgb},0.08)`,
      text: {
        primary: textBase.primary,
        secondary: textBase.secondary,
        muted: `rgba(${textBase.rgb},0.4)`,
        ghost: `rgba(${textBase.rgb},0.2)`,
      },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  };
}

function hexToRgb(hex: string): string {
  const v = hex.replace('#', '');
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function textRgbForAccent(accentHex: string): { primary: string; secondary: string; rgb: string } {
  // Block-1 provisional: text is a desaturated tint of the accent.
  // Lyra will finalise per-mindspace text palettes; this keeps the
  // resolution engine demonstrable until then.
  const v = accentHex.replace('#', '');
  const r = Math.min(255, Number.parseInt(v.slice(0, 2), 16) + 60);
  const g = Math.min(255, Number.parseInt(v.slice(2, 4), 16) + 60);
  const b = Math.min(255, Number.parseInt(v.slice(4, 6), 16) + 60);
  return {
    primary: `rgb(${r},${g},${b})`,
    secondary: `rgb(${Math.max(0, r - 8)},${Math.max(0, g - 8)},${Math.max(0, b - 8)})`,
    rgb: `${r},${g},${b}`,
  };
}
