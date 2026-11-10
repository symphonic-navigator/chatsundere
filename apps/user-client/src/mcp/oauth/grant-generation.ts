// SPDX-License-Identifier: AGPL-3.0-only
import type { McpOAuthGrantRow } from '../../boot/client-data-db.js';

/** The three generation fields of a grant row (MCP OAuth hardening spec §5.1). */
export type GenerationFields = Pick<
  McpOAuthGrantRow,
  'generation' | 'seenGeneration' | 'heldGeneration'
>;

/** The synced generation of a row; a grant that predates generations reads as 0. */
export function generationOf(row: { generation?: number } | null | undefined): number {
  return row?.generation ?? 0;
}

/** This device's high-water mark of generations it has seen; absent reads as 0. */
export function seenOf(row: { seenGeneration?: number } | null | undefined): number {
  return row?.seenGeneration ?? 0;
}

/** The generation a push must carry: strictly above everything this device has seen or based on. */
export function nextGeneration(local: GenerationFields, baseGeneration: number): number {
  return Math.max(seenOf(local), baseGeneration) + 1;
}

/** Stamps a row for publishing with its next generation, mirrored into the high-water mark. */
export function stampForPush(row: McpOAuthGrantRow, baseGeneration: number): McpOAuthGrantRow {
  const generation = nextGeneration(row, baseGeneration);
  return { ...row, generation, seenGeneration: generation, heldGeneration: null };
}

export type PulledGrantVerdict = { kind: 'apply' } | { kind: 'refuse'; heldGeneration: number };

/** Decides whether a pulled grant may replace the local one, or is an older generation to hold off. */
export function judgePulledGrant(
  local: GenerationFields | undefined,
  pulled: { generation?: number },
): PulledGrantVerdict {
  if (local === undefined) return { kind: 'apply' };
  if (generationOf(pulled) >= seenOf(local)) return { kind: 'apply' };
  return { kind: 'refuse', heldGeneration: generationOf(pulled) };
}

/** The bookkeeping fields to write when a pulled grant is applied. */
export function acceptedFields(
  local: GenerationFields | undefined,
  pulled: { generation?: number },
): { seenGeneration: number; heldGeneration: null } {
  return {
    seenGeneration: Math.max(seenOf(local), generationOf(pulled)),
    heldGeneration: null,
  };
}

/** The bookkeeping fields for an acknowledged push, or null when a newer generation was seen meanwhile. */
export function ackFields(
  local: GenerationFields,
  pushedGeneration: number,
): { seenGeneration: number; heldGeneration: null } | null {
  if (pushedGeneration < seenOf(local)) return null;
  return { seenGeneration: Math.max(seenOf(local), pushedGeneration), heldGeneration: null };
}

/** Whether this device is holding off an older-generation grant (spec §5.1). */
export function isGrantHeld(row: GenerationFields): boolean {
  return row.heldGeneration != null;
}

/** A grant with neither published tokens nor a pending pair has nothing left to use. */
export function isGrantDead(row: Pick<McpOAuthGrantRow, 'tokens' | 'pendingTokens'>): boolean {
  return row.tokens === null && !row.pendingTokens;
}

/** A new sign-in's pair waiting to publish here; the hold never blocks it (spec §5.4). */
export function hasPendingNewSignIn(
  row: Pick<McpOAuthGrantRow, 'pendingTokens' | 'pendingNewFamily'>,
): boolean {
  return row.pendingTokens != null && row.pendingNewFamily === true;
}

/** Display only, never a gate: held, unless a new sign-in pending here will publish regardless. */
export function isGrantPaused(
  row: Pick<McpOAuthGrantRow, 'heldGeneration' | 'pendingTokens' | 'pendingNewFamily'>,
): boolean {
  return isGrantHeld(row) && !hasPendingNewSignIn(row);
}

/** The one liveness rule (spec §5.4): present, not paused, not dead. */
export function isGrantLive(row: McpOAuthGrantRow | undefined): boolean {
  return row !== undefined && !isGrantPaused(row) && !isGrantDead(row);
}
