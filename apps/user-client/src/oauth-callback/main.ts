// SPDX-License-Identifier: AGPL-3.0-only
import {
  CALLBACK_CHANNEL,
  type CallbackPayload,
  encodeCallbackPayload,
} from '../mcp/oauth/callback-payload';

/** How long the page waits for the app tab before it shows the code itself. */
const ACK_WAIT_MS = 1500;

/** What the page shows. `paste` is the `csm1.` text, or null when nothing can be pasted. */
export type CallbackView =
  | { view: 'done' }
  | { view: 'code'; paste: string }
  | { view: 'cancelled'; paste: string | null };

/** The slice of BroadcastChannel this page needs, so tests can fake it. */
export interface CallbackChannel {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

/** Everything `runCallback` touches, injected for testing. */
export interface CallbackDeps {
  location: Location;
  history: History;
  channel: CallbackChannel;
  render: (view: CallbackView) => void;
  close: () => void;
  wait: (ms: number) => Promise<void>;
}

function payloadFrom(search: string): CallbackPayload | null {
  const q = new URLSearchParams(search);
  const state = q.get('state');
  if (!state) return null;
  const error = q.get('error');
  if (error) return { error, state };
  const code = q.get('code');
  if (!code) return null;
  const iss = q.get('iss');
  return iss ? { code, state, iss } : { code, state };
}

/**
 * Hands the redirect result to the waiting app tab; if no tab answers within
 * 1.5 s, shows a pasteable code instead. A late answer still wins.
 */
export async function runCallback(deps: CallbackDeps): Promise<void> {
  const search = deps.location.search;
  // The query holds a one-time code; get it out of the address bar and history first.
  deps.history.replaceState(null, '', deps.location.pathname);

  const payload = payloadFrom(search);
  if (!payload) {
    deps.render({ view: 'cancelled', paste: null });
    return;
  }
  const isError = 'error' in payload;
  let acked = false;
  let release: () => void = () => {};
  const firstAck = new Promise<void>((res) => {
    release = res;
  });

  deps.channel.onmessage = (event) => {
    const d = event.data as { type?: unknown; state?: unknown } | null;
    if (!d || d.type !== 'ack' || d.state !== payload.state) return;
    acked = true;
    release();
    if (isError) deps.render({ view: 'cancelled', paste: null });
    else {
      deps.render({ view: 'done' });
      // Under COOP the page cannot close the app, and the browser may refuse to
      // close this one; the done view then stays on screen.
      deps.close();
    }
  };

  deps.channel.postMessage({ type: 'result', payload });
  await Promise.race([firstAck, deps.wait(ACK_WAIT_MS)]);
  if (acked) return;
  const paste = encodeCallbackPayload(payload);
  deps.render(isError ? { view: 'cancelled', paste } : { view: 'code', paste });
}

function bootstrap(root: HTMLElement): void {
  const views = root.querySelectorAll<HTMLElement>('[data-view]');
  const fields = root.querySelectorAll<HTMLTextAreaElement>('[data-paste]');
  const pasteBox = root.querySelector<HTMLElement>('[data-cancel-paste]');
  for (const copy of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    copy.addEventListener('click', async () => {
      const field = copy.parentElement?.querySelector<HTMLTextAreaElement>('[data-paste]');
      if (!field) return;
      try {
        await navigator.clipboard.writeText(field.value);
        copy.textContent = 'Copied';
      } catch {
        field.focus();
        field.select();
      }
    });
  }
  void runCallback({
    location: window.location,
    history: window.history,
    channel: new BroadcastChannel(CALLBACK_CHANNEL),
    render: (v) => {
      const paste = v.view === 'done' ? null : v.paste;
      for (const f of fields) f.value = paste ?? '';
      if (pasteBox) pasteBox.hidden = paste === null;
      for (const el of views) el.hidden = el.dataset.view !== v.view;
    },
    close: () => window.close(),
    wait: (ms) => new Promise((res) => setTimeout(res, ms)),
  });
}

const root = typeof document === 'undefined' ? null : document.getElementById('oauth-callback');
if (root) bootstrap(root);
