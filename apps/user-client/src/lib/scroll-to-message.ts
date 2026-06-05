// SPDX-License-Identifier: AGPL-3.0-only

const HIGHLIGHT_CLASS = 'msg-focus-pulse';
const HIGHLIGHT_MS = 1600;

/** Scroll the message with the given id into view (centred) and play a brief
 *  highlight pulse. Returns false when the element is not currently in the
 *  DOM. `scrollIntoView` is guarded for jsdom, which omits it. */
export function scrollToMessage(messageId: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(messageId)}"]`);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
  return true;
}
