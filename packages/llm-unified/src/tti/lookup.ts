// SPDX-License-Identifier: LGPL-3.0-only
import { getOffering } from '../registry.js';
import type { TtiDescriptor } from './descriptor.js';

/** Resolve a stored "providerId:upstreamSlug" ref to its TTI descriptor. */
export function getTtiDescriptor(ref: string): TtiDescriptor | undefined {
  const idx = ref.indexOf(':');
  if (idx < 0) return undefined;
  const offering = getOffering(ref.slice(0, idx), ref.slice(idx + 1));
  return offering?.serviceKind === 'tti' ? offering.tti : undefined;
}
