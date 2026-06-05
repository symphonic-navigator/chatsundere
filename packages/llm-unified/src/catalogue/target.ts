// SPDX-License-Identifier: LGPL-3.0-only
import type { Offering } from './types.js';

/**
 * Minimal view the runtime needs to issue a completion: the upstream model
 * slug and, when the offering is catalogue-adapted, its adapter id. Keeps
 * stream-completion/one-shot decoupled from the catalogue/selection model.
 */
export interface CompletionTarget {
  slug: string;
  adapterId?: string;
}

/** Convert a catalogue offering into the minimal target the runtime needs. */
export function offeringToTarget(o: Offering): CompletionTarget {
  return {
    slug: o.upstreamSlug,
    ...(o.adapter.kind === 'catalogue' ? { adapterId: o.adapter.adapterId } : {}),
  };
}
