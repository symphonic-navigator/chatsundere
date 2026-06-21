// SPDX-License-Identifier: AGPL-3.0-only

/** Process-local per-chat lock. A held lock makes the next trigger drop (not
 *  queue) — compaction is idempotent-enough that a missed background tick is
 *  harmless (the next send re-evaluates fill). */
const active = new Set<string>();

export function tryAcquireCompactionLock(chatId: string): boolean {
  if (active.has(chatId)) return false;
  active.add(chatId);
  return true;
}

export function releaseCompactionLock(chatId: string): void {
  active.delete(chatId);
}

export function _resetCompactionLocksForTests(): void {
  active.clear();
}
