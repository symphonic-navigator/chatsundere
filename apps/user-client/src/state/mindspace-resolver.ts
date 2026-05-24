// SPDX-License-Identifier: AGPL-3.0-only

import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';

export interface ResolvedMindspace extends MindspaceRow {
  /** Resolved texture (may differ from MindspaceRow.texture). */
  texture: MindspaceTexture;
}

export interface ResolverArgs {
  persona: { mindspaceId: string | null; textureOverride: MindspaceTexture | null } | null;
  defaultMindspaceId: string;
  defaultTexture: MindspaceTexture | null;
  mindspaces: ReadonlyArray<MindspaceRow>;
}

/**
 * Resolve the active mindspace and texture for the current context.
 * Resolution priority:
 *   mindspace: persona.mindspaceId > defaultMindspaceId > first available
 *   texture:   persona.textureOverride > defaultTexture > mindspace.texture
 * Returns null when the mindspaces list is empty.
 */
export function resolveMindspace(args: ResolverArgs): ResolvedMindspace | null {
  const { persona, defaultMindspaceId, defaultTexture, mindspaces } = args;
  if (mindspaces.length === 0) return null;
  const wantedId = persona?.mindspaceId ?? defaultMindspaceId;
  const ms = mindspaces.find((m) => m.id === wantedId) ?? mindspaces[0];
  if (!ms) return null;
  const texture = persona?.textureOverride ?? defaultTexture ?? ms.texture;
  return { ...ms, texture };
}
