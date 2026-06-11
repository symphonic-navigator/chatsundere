// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Same-session resume memory for voice playback. When the user leaves a chat
 * mid-playback the transport remembers where they were, so on return it can
 * offer `Resume · ¶k`. Memory is module-level and per-chat — it lives only for
 * the page session: a reload starts fresh (resume honesty, spec §4).
 *
 * Pure module: no I/O, no React. The hook ({@link useVoicePlayback}) is the
 * sole writer/reader; tests drive it directly via {@link _resetResumeMemoryForTests}.
 */

export interface ResumePosition {
  messageId: string;
  /** Index into the segment list as it was segmented at play time. */
  segmentIndex: number;
  /** Paragraph index of the remembered segment — drives the `Resume · ¶k` label. */
  paragraphIndex: number;
}

const positions = new Map<string, ResumePosition>();

/** Record (or overwrite) the remembered position for a chat. */
export function rememberPosition(chatId: string, pos: ResumePosition): void {
  positions.set(chatId, pos);
}

/**
 * Read the remembered position for a chat WITHOUT clearing it. Non-destructive
 * by design: re-entering a chat twice still offers resume until playback
 * actually starts (which clears it via {@link clearPosition}).
 */
export function peekPosition(chatId: string): ResumePosition | null {
  return positions.get(chatId) ?? null;
}

/** Forget any remembered position for a chat (called when playback starts). */
export function clearPosition(chatId: string): void {
  positions.delete(chatId);
}

/** Test seam: wipe all remembered positions between cases. */
export function _resetResumeMemoryForTests(): void {
  positions.clear();
}
