// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';

/**
 * Device-local field discipline before seal, and restore-local-on-open (spec
 * §10). SECURITY-CRITICAL: the polarity is deliberate and Larissa-pinned (I-2).
 *
 * `settings` uses **ALLOWLIST** polarity: only the fields explicitly listed in
 * {@link SETTINGS_SYNC_ALLOWLIST} are ever sealed. Everything else — including
 * any field added in the future — stays device-local automatically and is
 * restored from the local row on open. This is the one collection where
 * sync-by-default would compose badly with server-wins whole-row application,
 * so a new field is opted **in** consciously, never leaked by omission.
 *
 * Every OTHER collection uses **deny-list** strip: named device-local / derived
 * / transient fields are removed before seal and restored on open; unknown
 * (new) fields sync by default.
 */

/**
 * The account-level `settings` fields that are genuinely user-account settings
 * and are sealed for cross-device sync. Everything NOT listed here stays
 * device-local by construction (allowlist polarity, Larissa I-2). Deliberately
 * device-local and therefore ABSENT:
 *  - `id`                 — the singleton key (always 1), structural, not data.
 *  - `adultMode`          — privacy-sensitive content mode; migration v5 pins it
 *                           device-local (must never be forced across devices).
 *  - `corsProxy`          — secret-bearing (`EncryptedBlob` sealed under the
 *                           LOCAL MK's secrets DEK) and dormant; sealing it into
 *                           a cross-device envelope would break the secret on
 *                           other devices (§13 uplevelling coupling).
 *  - `animationsEnabled`  — per-device motion / performance / accessibility toggle.
 *  - `screenEffectsEnabled` — per-device full-screen-overlay performance toggle.
 *  - `spectrumEnabled` / `spectrumStyle` / `spectrumOpacity` / `spectrumBarCount`
 *                         — per-device analyser render config (barCount is a
 *                           render-cost knob; aesthetic-per-device).
 *  - `voiceStopHintSeen`  — one-shot UI onboarding flag; per-device tutorial state.
 *  - `createdAt`          — device-specific row-creation timestamp; not meaningful
 *                           to overwrite across devices.
 * `updatedAt` IS sealed — the settings replay guard (§7.5, M-8) compares it
 * across devices, so it must survive the round trip.
 */
export const SETTINGS_SYNC_ALLOWLIST: readonly string[] = [
  'displayName',
  'globalInstructions',
  'globalAboutMe',
  'defaultMindspaceId',
  'userTexture',
  'webInterfacing',
  'expertWeb',
  'substituteVisionModel',
  'expertModel',
  'artefactExpertModel',
  'imageGeneration',
  'voiceMode',
  'dictationSensitivity',
  'dictationRedemptionMs',
  'dictationAutoSend',
  'ttsOffering',
  'sttOffering',
  'autoReadAloud',
  'ttsHighpass',
  'updatedAt',
];

/**
 * Per-collection deny-lists (spec §5/§10): device-local, derived, or transient
 * fields removed before seal and restored on open. Collections absent from this
 * map are sealed whole (new fields sync by default).
 */
const DENY_LISTS: Partial<Record<SyncCollection, readonly string[]>> = {
  chats: [
    // Device-local / transient
    'draftInput',
    'editingMessageId',
    'openerPending',
    'compactionToastShown',
    // Locally derived (never synced — recomputed on this device)
    'lastMessageAt',
    'bookmarkedMessageCount',
    'activeCompactionId',
  ],
  mcpServers: [
    // Device-probe results — another device's outcome is functional staleness
    'resolvedEndpoint',
    'lastTestedAt',
    'lastError',
    'routing',
  ],
  documents: [
    // Device-local embedding pipeline state (Finding V). Vectors are
    // deliberately one-directional: a peer RE-EMBEDS a pulled document from its
    // `content` rather than receiving vector bytes, so the origin device's
    // status/error/count describe work done on THAT device only — sealing them
    // would land a fresh device with `embeddingStatus: 'ready'` and zero local
    // vectors, silently unsearchable and never picked up by the boot ingestion
    // sweep. `apply.ts`'s post-apply hook re-defaults these to `pending` when
    // this device holds no vectors for the pulled document.
    'embeddingStatus',
    'embeddingError',
    'chunkCount',
  ],
};

/**
 * Whether a partial patch touches any field that is actually SYNCED for the
 * collection (spec §5/§10). Generic edit hooks (`useUpdateSettings`,
 * `useUpdateChat`) mix synced fields (e.g. `settings.displayName`,
 * `chats.title`) with device-local ones (`settings.adultMode`,
 * `chats.draftInput`): a device-local-only patch must stay editable offline
 * (plain local write, never gated), while any synced-field patch is a genuine
 * Class-2 mutation that goes through `mutateSynced`. Single source of truth with
 * {@link stripForSeal}: settings uses the allowlist, everything else the
 * deny-list; a collection with no deny-list syncs every field.
 */
export function patchTouchesSyncedField(
  collection: SyncCollection,
  keys: readonly string[],
): boolean {
  if (keys.length === 0) return false;
  if (collection === 'settings') {
    return keys.some((k) => SETTINGS_SYNC_ALLOWLIST.includes(k));
  }
  const denied = DENY_LISTS[collection];
  if (!denied) return true; // no deny-list → every field syncs
  return keys.some((k) => !denied.includes(k));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Strip device-local fields from a row before sealing it (§10). */
export function stripForSeal(collection: SyncCollection, row: unknown): unknown {
  if (!isRecord(row)) return row;

  if (collection === 'settings') {
    // Allowlist polarity: build the sealed form from listed fields only.
    const sealed: Record<string, unknown> = {};
    for (const field of SETTINGS_SYNC_ALLOWLIST) {
      if (field in row) sealed[field] = row[field];
    }
    return sealed;
  }

  const denied = DENY_LISTS[collection];
  if (!denied) return { ...row };

  const sealed: Record<string, unknown> = { ...row };
  for (const field of denied) delete sealed[field];
  return sealed;
}

/**
 * After opening a pulled record, re-apply this device's local-only fields (§10).
 * For `settings` the pulled row already carries only allowlisted fields, so the
 * local values of every other field are preserved. For deny-list collections,
 * the removed fields are restored from the local row when one exists.
 */
export function restoreLocalFields(
  collection: SyncCollection,
  pulled: unknown,
  local: unknown | undefined,
): unknown {
  if (!isRecord(pulled)) return pulled;

  if (collection === 'settings') {
    // Server wins the allowlisted fields; every device-local field keeps its
    // local value. `id` is always the singleton 1.
    const localRecord = isRecord(local) ? local : {};
    return { ...localRecord, ...pulled, id: 1 };
  }

  const denied = DENY_LISTS[collection];
  if (!denied || !isRecord(local)) return { ...pulled };

  const restored: Record<string, unknown> = { ...pulled };
  for (const field of denied) {
    if (field in local) restored[field] = local[field];
  }
  return restored;
}
