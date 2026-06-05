// SPDX-License-Identifier: AGPL-3.0-only

/** Minimal shape we need from an Offering — keeps this module decoupled from the catalogue type. */
export interface VisionCapable {
  profile: { vision: boolean };
}

/** Returns the `VisionCapable` shape for a given offering ref, or `undefined` if the ref is unknown. */
export type OfferingLookup = (ref: string) => VisionCapable | undefined;

function sees(ref: string | null, lookup: OfferingLookup): boolean {
  if (!ref) return false;
  return lookup(ref)?.profile.vision === true;
}

/**
 * Determine whether the current configuration can send images at all.
 *
 * Precedence (Chris's rule): the active model's own vision always wins; otherwise a
 * configured vision-capable substitute enables images; otherwise images cannot be seen.
 */
export function canSendImages(
  activeRef: string,
  substituteRef: string | null,
  lookup: OfferingLookup,
): boolean {
  return sees(activeRef, lookup) || sees(substituteRef, lookup);
}

/** How a single image should reach the model on a given send. */
export type Disposition = 'direct' | 'substitute' | 'placeholder';

/**
 * Determine how an image attachment should be handled for this send.
 *
 * - `direct` — the active model receives the image inline.
 * - `substitute` — the active model is blind; the substitute model describes the image first.
 * - `placeholder` — neither model can see; a text note is injected instead.
 */
export function imageDisposition(
  activeRef: string,
  substituteRef: string | null,
  lookup: OfferingLookup,
): Disposition {
  if (sees(activeRef, lookup)) return 'direct';
  if (sees(substituteRef, lookup)) return 'substitute';
  return 'placeholder';
}
