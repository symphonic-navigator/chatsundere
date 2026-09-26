// SPDX-License-Identifier: AGPL-3.0-only

/** Channel every open Chatsundere client listens on (spec 2026-09-26 §2.5). */
export const PRESENCE_CHANNEL = 'chatsundere-clients';

// Per-tab id to distinguish this tab's probe from other tabs' probes, preventing
// this tab's own responder from answering its own probe (which would occur because
// two separate BroadcastChannel objects in the same document receive each other's messages).
// Not crypto.randomUUID(): it is absent in non-secure self-hosted contexts and would
// throw at import, before the runtime-check screen can explain anything. The id only
// needs to be distinct per tab, not unguessable.
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

type PresenceMessage = { type: 'presence?'; from: string } | { type: 'presence!' };

/** Answers other clients' presence pings for the life of this page; returns a stop function. */
export function startPresenceResponder(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(PRESENCE_CHANNEL);
  channel.onmessage = (e: MessageEvent<PresenceMessage>) => {
    if (e.data?.type === 'presence?' && e.data.from !== TAB_ID)
      channel.postMessage({ type: 'presence!' } satisfies PresenceMessage);
  };
  return () => channel.close();
}

/** Resolves true if any other Chatsundere client answers within the timeout. */
export async function otherClientsOpen(timeoutMs = 300): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return false;
  const channel = new BroadcastChannel(PRESENCE_CHANNEL);
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      channel.onmessage = (e: MessageEvent<PresenceMessage>) => {
        if (e.data?.type === 'presence!') {
          clearTimeout(timer);
          resolve(true);
        }
      };
      channel.postMessage({ type: 'presence?', from: TAB_ID } satisfies PresenceMessage);
    });
  } finally {
    channel.close();
  }
}
