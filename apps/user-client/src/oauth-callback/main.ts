// SPDX-License-Identifier: AGPL-3.0-only
import {
  CALLBACK_CHANNEL,
  type CallbackPayload,
  encodeCallbackPayload,
} from '../mcp/oauth/callback-payload';
import { type PendingPresence, checkPendingState } from './pending-check';

/** How long the page waits for the app tab before it shows the code itself. */
const ACK_WAIT_MS = 1500;

/**
 * What the page shows. `paste` is the `csm1.` text, or null when nothing can be pasted.
 * `foreign` means this browser certainly did not start the sign-in, so the code sits
 * behind a deliberate step (a phished victim must not be handed it in one tap).
 */
export type CallbackView =
  | { view: 'done' }
  | { view: 'code'; paste: string; issHost: string | null; foreign: boolean }
  | { view: 'cancelled'; paste: string | null }
  | { view: 'failed'; paste: string | null }
  | { view: 'empty' };

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
  /** Whether this browser holds the pending sign-in; absent means "unknown". */
  checkState?: (state: string) => Promise<PendingPresence>;
}

function hostOf(iss: string | undefined): string | null {
  if (iss === undefined) return null;
  try {
    return new URL(iss).host || null;
  } catch {
    return null;
  }
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
    deps.render({ view: 'empty' });
    return;
  }
  const isError = 'error' in payload;
  // Only a refusal by the user reads as cancelled; anything else did not finish.
  const errorView =
    'error' in payload && payload.error === 'access_denied' ? 'cancelled' : 'failed';
  const presence: Promise<PendingPresence> =
    isError || !deps.checkState
      ? Promise.resolve('unknown')
      : deps.checkState(payload.state).catch(() => 'unknown' as const);
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
    if (isError) deps.render({ view: errorView, paste: null });
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
  if ('error' in payload) {
    deps.render({ view: errorView, paste });
    return;
  }
  const foreign = (await presence) === 'absent';
  // The acknowledgement may have arrived while the check ran.
  if (acked) return;
  deps.render({ view: 'code', paste, issHost: hostOf(payload.iss), foreign });
}

/**
 * Wires the page's buttons and returns the function that shows a view. Exported so the
 * markup and its behaviour can be tested together.
 */
export function mountPage(root: HTMLElement): (view: CallbackView) => void {
  const views = root.querySelectorAll<HTMLElement>('[data-view]');
  const fields = root.querySelectorAll<HTMLTextAreaElement>('[data-paste]');
  const pasteBoxes = root.querySelectorAll<HTMLElement>('[data-error-paste]');
  const foreignBox = root.querySelector<HTMLElement>('[data-foreign]');
  const codeBox = root.querySelector<HTMLElement>('[data-code-block]');
  const warnHere = root.querySelector<HTMLElement>('[data-warning-here]');
  const warnElsewhere = root.querySelector<HTMLElement>('[data-warning-elsewhere]');
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
  root.querySelector<HTMLButtonElement>('[data-reveal]')?.addEventListener('click', () => {
    if (foreignBox) foreignBox.hidden = true;
    if (codeBox) codeBox.hidden = false;
    if (warnHere) warnHere.hidden = true;
    if (warnElsewhere) warnElsewhere.hidden = false;
  });
  return (v) => {
    const paste = 'paste' in v ? v.paste : null;
    for (const f of fields) f.value = paste ?? '';
    for (const box of pasteBoxes) box.hidden = paste === null;
    if (v.view === 'code') {
      // textContent, never markup: the host comes from the redirect's query.
      for (const el of root.querySelectorAll<HTMLElement>('[data-iss-host]')) {
        el.textContent = v.issHost ?? '';
      }
      for (const el of root.querySelectorAll<HTMLElement>('[data-iss-phrase]')) {
        el.hidden = v.issHost === null;
      }
      if (foreignBox) foreignBox.hidden = !v.foreign;
      if (codeBox) codeBox.hidden = v.foreign;
      if (warnHere) warnHere.hidden = false;
      if (warnElsewhere) warnElsewhere.hidden = true;
    }
    for (const el of views) el.hidden = el.dataset.view !== v.view;
  };
}

function bootstrap(root: HTMLElement): void {
  void runCallback({
    location: window.location,
    history: window.history,
    channel: new BroadcastChannel(CALLBACK_CHANNEL),
    render: mountPage(root),
    close: () => window.close(),
    wait: (ms) => new Promise((res) => setTimeout(res, ms)),
    checkState: (state) => checkPendingState(globalThis.indexedDB, state),
  });
}

const root = typeof document === 'undefined' ? null : document.getElementById('oauth-callback');
if (root) bootstrap(root);
