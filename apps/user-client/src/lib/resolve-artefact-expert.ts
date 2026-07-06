// SPDX-License-Identifier: AGPL-3.0-only
import type { OfferingRef } from '../integrations/types.js';

/**
 * Resolve the artefact-expert offering for a send, or null to use the persona
 * model. `ref` is the global `settings.artefactExpertModel`
 * (`"providerTemplateId:upstreamSlug"`, or null/absent = none); the chat opts
 * out with `useArtefactExpertModel === false` (absent ⇒ the expert is used).
 * A malformed ref resolves to null (no expert), never a throw.
 */
export function resolveArtefactExpert(
  ref: string | null | undefined,
  chat: { useArtefactExpertModel?: boolean },
): OfferingRef | null {
  if (!ref) return null;
  if (chat.useArtefactExpertModel === false) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}
