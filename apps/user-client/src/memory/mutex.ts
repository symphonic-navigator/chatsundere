// SPDX-License-Identifier: AGPL-3.0-only

/** Process-local per-persona lock. Replaces chatsune's Redis slot. A held lock
 *  makes the next post-send trigger drop (not queue) — each stage is idempotent
 *  on re-run, so a missed tick is harmless. */
const active = new Set<string>();

export function tryAcquireMemoryLock(personaId: string): boolean {
  if (active.has(personaId)) return false;
  active.add(personaId);
  return true;
}

export function releaseMemoryLock(personaId: string): void {
  active.delete(personaId);
}

export function _resetMemoryLocksForTests(): void {
  active.clear();
}
