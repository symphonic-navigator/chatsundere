// SPDX-License-Identifier: AGPL-3.0-only

/** Who is currently sounding: 'read-aloud', 'monologue', 'live-voice' or `player:<artefactId>`. */
export type FloorOwner = string;

let owner: FloorOwner | null = null;
let yieldOwner: (() => void) | null = null;

/** Takes the floor, asking the previous (different) owner to pause itself. */
export function claimMediaFloor(next: FloorOwner, yieldFloor: () => void): void {
  const previousYield = owner !== null && owner !== next ? yieldOwner : null;
  owner = next;
  yieldOwner = yieldFloor;
  previousYield?.();
}

/** Gives the floor up; a no-op unless `who` holds it. Never resumes anyone. */
export function releaseMediaFloor(who: FloorOwner): void {
  if (owner !== who) return;
  owner = null;
  yieldOwner = null;
}

/** The current floor owner, or null when nothing is sounding. */
export function currentFloorOwner(): FloorOwner | null {
  return owner;
}
