// SPDX-License-Identifier: AGPL-3.0-only

import type { MindspaceRow, PersonaRow } from '../boot/client-data-db.js';

export interface ResolveArgs {
  persona: PersonaRow | null;
  defaultMindspaceId: string;
  mindspaces: ReadonlyArray<MindspaceRow>;
}

/**
 * Resolve the active mindspace for the current context, per Spec § 5.2
 * resolution priority: persona-override > user-default > first available.
 * Throws when the mindspaces list is empty (built-ins are seeded on first
 * launch, so an empty list at runtime is a bug).
 */
export function resolveMindspace(args: ResolveArgs): MindspaceRow {
  const { persona, defaultMindspaceId, mindspaces } = args;
  if (mindspaces.length === 0) {
    throw new Error('resolveMindspace: no mindspaces available — built-ins should be seeded');
  }
  const byId = (id: string) => mindspaces.find((m) => m.id === id);
  if (persona?.mindspaceId) {
    const override = byId(persona.mindspaceId);
    if (override) return override;
  }
  const fallback = byId(defaultMindspaceId);
  if (fallback) return fallback;
  // Last-resort fallback: first available mindspace. Maintains the invariant
  // that the engine always returns a real row even when references stale.
  // We are guaranteed to have at least one mindspace here due to the check above.
  const first = mindspaces[0];
  if (!first) {
    throw new Error('resolveMindspace: no mindspaces available — built-ins should be seeded');
  }
  return first;
}
