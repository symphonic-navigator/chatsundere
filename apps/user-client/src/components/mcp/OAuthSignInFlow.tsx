// SPDX-License-Identifier: AGPL-3.0-only
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { QK } from '../../data/queryKeys.js';
import { isProxyAvailable } from '../../lib/proxy-auth.js';
import { type CallbackPayload, decodeCallbackPayload } from '../../mcp/oauth/callback-payload.js';
import { checkServer } from '../../mcp/oauth/check-server.js';
import type { OAuthDiscovery } from '../../mcp/oauth/discovery.js';
import { createSignInDeps, loadPendingSignIn } from '../../mcp/oauth/sign-in-session.js';
import {
  type CompleteResult,
  type ServerDraft,
  cancelSignIn,
  completeSignIn,
  holdPendingSignIn,
  listenForCallback,
  prepareSignIn,
} from '../../mcp/oauth/sign-in.js';
import { assertSecureEndpoint } from '../../mcp/oauth/url.js';
import {
  SignInAlreadyConnected,
  SignInConfirm,
  SignInOutcome,
  SignInWaiting,
} from './SignInScreens.js';
import {
  CODE_NOT_OURS,
  FAILURES,
  type OutcomeAction,
  SAVING_LATER,
  type SignInFailure,
  UNLOCK_TO_FINISH,
  completeFailure,
  hostOf,
  prepareFailure,
} from './sign-in-copy.js';

/** A pending sign-in lives this long (spec §5); the visible screen expires with it. */
const LIFETIME_MS = 10 * 60_000;

/** The clock and timer of the flow, injectable so tests can move time. */
export type FlowTimers = {
  now(): number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule(fn: () => void, ms: number): () => void;
};

const realTimers: FlowTimers = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** Props of the sign-in flow, used both on its page and over a chat. */
export type OAuthSignInFlowProps = {
  /** What *Check server* found; absent when resuming a pending sign-in by `state`. */
  discovery?: OAuthDiscovery | undefined;
  /** The existing server a reconnect signs in again for; absent for a new server. */
  serverId?: string | undefined;
  /** The new server's settings, saved once the grant exists; null for a reconnect. */
  draft: ServerDraft | null;
  extraScopes?: string[] | undefined;
  /** Resume this device's pending sign-in with this state, straight on its waiting screen. */
  state?: string | undefined;
  mode: 'page' | 'overlay';
  onConnected: (result: { serverId: string; draft: ServerDraft | null }) => void | Promise<void>;
  /** Switches to key fields; given the link being signed in to, when known. */
  onUseKey?: ((link: string | null) => void) | undefined;
  onClose: () => void;
  timers?: FlowTimers | undefined;
};

type Step =
  | { kind: 'loading' }
  | { kind: 'preparing' }
  | { kind: 'confirm' }
  | { kind: 'waiting'; finishing: boolean }
  | { kind: 'already'; serverId: string; draft: ServerDraft | null }
  | { kind: 'connected'; savingLater: boolean }
  | { kind: 'failed'; failure: SignInFailure };

type Pending = { state: string; url: string | null; createdAt: number };
type SignInArgs = { serverId?: string; draft: ServerDraft | null; extraScopes?: string[] };

function secureOrNull(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    assertSecureEndpoint(url, 'authorisation');
    return url;
  } catch {
    return null;
  }
}

/**
 * The confirmation, waiting and failure screens of an OAuth sign-in (MCP OAuth spec §9).
 * All preparation finishes before *Continue to sign-in* is enabled, because that click is
 * the gesture iOS needs for the window. Leaving the waiting screen keeps the pending
 * sign-in; only *Cancel* deletes it.
 */
export function OAuthSignInFlow(props: OAuthSignInFlowProps): JSX.Element {
  const timers = props.timers ?? realTimers;
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(
    props.state !== undefined ? { kind: 'loading' } : { kind: 'preparing' },
  );
  const [hosts, setHosts] = useState(() => ({
    server: props.discovery ? hostOf(props.discovery.resource) : '',
    auth: props.discovery ? hostOf(props.discovery.issuer) : '',
  }));
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const discoveryRef = useRef<OAuthDiscovery | null>(props.discovery ?? null);
  const resourceRef = useRef<string | null>(props.discovery?.resource ?? null);
  const argsRef = useRef<SignInArgs>({
    ...(props.serverId !== undefined ? { serverId: props.serverId } : {}),
    draft: props.draft,
    ...(props.extraScopes !== undefined ? { extraScopes: props.extraScopes } : {}),
  });
  const pendingRef = useRef<Pending | null>(null);
  // Whether the window was opened for the current pending sign-in; only then does leaving keep it.
  const openedRef = useRef(false);
  const finishingRef = useRef(false);
  // Bumped on unmount and on each new preparation, so a late result is never adopted.
  const genRef = useRef(0);

  const refreshPending = () => void qc.invalidateQueries({ queryKey: QK.mcpOAuthPending });

  const fail = (failure: SignInFailure) => setStep({ kind: 'failed', failure });

  async function prepare(d: OAuthDiscovery): Promise<void> {
    const gen = ++genRef.current;
    openedRef.current = false;
    setStep({ kind: 'preparing' });
    setPaste('');
    setPasteError(null);
    try {
      const startedAt = timers.now();
      const deps = { ...(await createSignInDeps()), now: timers.now };
      const r = await prepareSignIn(d, argsRef.current, deps);
      if (gen !== genRef.current) {
        void cancelSignIn(r.state);
        return;
      }
      pendingRef.current = { state: r.state, url: r.authorizationUrl, createdAt: startedAt };
      refreshPending();
      setStep({ kind: 'confirm' });
    } catch (err) {
      if (gen === genRef.current) fail(prepareFailure(err));
    }
  }

  async function resume(state: string): Promise<void> {
    const gen = genRef.current;
    const p = await loadPendingSignIn(state);
    if (gen !== genRef.current) return;
    if (!p) {
      fail(FAILURES.gone);
      return;
    }
    holdPendingSignIn(state);
    openedRef.current = true;
    resourceRef.current = p.resource;
    argsRef.current = {
      ...(p.isNewServer ? {} : { serverId: p.serverId }),
      draft: p.draft,
    };
    setHosts({ server: hostOf(p.resource), auth: hostOf(p.issuer) });
    if (timers.now() - p.createdAt >= LIFETIME_MS) {
      void cancelSignIn(state);
      fail(FAILURES.expired);
      return;
    }
    pendingRef.current = { state, url: secureOrNull(p.authorizationUrl), createdAt: p.createdAt };
    setStep({ kind: 'waiting', finishing: false });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per mount by design
  useEffect(() => {
    if (props.state !== undefined) void resume(props.state);
    else if (discoveryRef.current) void prepare(discoveryRef.current);
    return () => {
      genRef.current++;
      const p = pendingRef.current;
      // Prepared but never opened: nothing to come back to, so it is not left behind.
      if (p && !openedRef.current) void cancelSignIn(p.state);
    };
  }, []);

  // The visible screen moves to "Sign-in expired" by itself when the pending row lapses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rescheduled per step only
  useEffect(() => {
    if (step.kind !== 'confirm' && step.kind !== 'waiting') return undefined;
    const p = pendingRef.current;
    if (!p) return undefined;
    const remaining = Math.max(0, p.createdAt + LIFETIME_MS - timers.now());
    return timers.schedule(() => {
      if (pendingRef.current?.state !== p.state) return;
      pendingRef.current = null;
      void cancelSignIn(p.state).then(refreshPending);
      fail(FAILURES.expired);
    }, remaining);
  }, [step.kind]);

  async function handleResult(r: CompleteResult): Promise<void> {
    if (r.ok) {
      pendingRef.current = null;
      setStep({ kind: 'connected', savingLater: false });
      refreshPending();
      void qc.invalidateQueries({ queryKey: QK.mcpOAuthGrants });
      await connected(r.serverId, r.draft);
      return;
    }
    switch (r.reason) {
      case 'already-connected':
        pendingRef.current = null;
        setStep({ kind: 'already', serverId: r.serverId, draft: r.draft });
        return;
      case 'unknown-state':
        setPasteError(CODE_NOT_OURS);
        setStep({ kind: 'waiting', finishing: false });
        return;
      case 'locked':
        setPasteError(UNLOCK_TO_FINISH);
        setStep({ kind: 'waiting', finishing: false });
        return;
      case 'cancelled':
      case 'expired':
        // completeSignIn deleted the pending row already.
        pendingRef.current = null;
        refreshPending();
        fail(completeFailure(r.reason));
        return;
      default:
        // The pending row survives a failed exchange; Start again replaces it.
        fail(completeFailure(r.reason));
    }
  }

  // The grant is stored by now, so a failing save is no failed sign-in: the list load's
  // finishOrphanedSignIns saves the server from the pending row's draft.
  async function connected(serverId: string, draft: ServerDraft | null): Promise<void> {
    try {
      await props.onConnected({ serverId, draft });
    } catch {
      setStep({ kind: 'connected', savingLater: true });
    }
  }

  async function finish(payload: CallbackPayload): Promise<void> {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setPasteError(null);
    setStep({ kind: 'waiting', finishing: true });
    try {
      const deps = { ...(await createSignInDeps()), now: timers.now };
      await handleResult(await completeSignIn(payload, deps));
    } catch {
      fail(FAILURES.exchangeFailed);
    } finally {
      finishingRef.current = false;
    }
  }

  function submit(payload: CallbackPayload | null): void {
    // A code for any other sign-in is refused here, even one this device also holds.
    if (!payload || payload.state !== pendingRef.current?.state) {
      setPasteError(CODE_NOT_OURS);
      return;
    }
    void finish(payload);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: listens per waiting screen only
  useEffect(() => {
    if (step.kind !== 'waiting') return undefined;
    const p = pendingRef.current;
    if (!p) return undefined;
    return listenForCallback((payload) => {
      if (payload.state === p.state) void finish(payload);
    });
  }, [step.kind]);

  function onPaste(value: string): void {
    setPaste(value);
    setPasteError(null);
    const payload = decodeCallbackPayload(value);
    if (payload) submit(payload);
  }

  // Synchronous on purpose: the click is the gesture the window needs.
  function openWindow(): void {
    const p = pendingRef.current;
    if (!p?.url) return;
    window.open(p.url, '_blank', 'noopener');
    openedRef.current = true;
  }

  function onContinue(): void {
    openWindow();
    setStep({ kind: 'waiting', finishing: false });
  }

  async function dropAndClose(): Promise<void> {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) await cancelSignIn(p.state);
    refreshPending();
    props.onClose();
  }

  async function startAgain(): Promise<void> {
    const old = pendingRef.current;
    pendingRef.current = null;
    if (old) void cancelSignIn(old.state).then(refreshPending);
    let d = discoveryRef.current;
    if (!d) {
      const resource = resourceRef.current;
      if (!resource) {
        props.onClose();
        return;
      }
      setStep({ kind: 'preparing' });
      const checked = await checkServer(resource, {
        hasProxy: isProxyAvailable(),
        allowDirect: argsRef.current.draft?.allowDirect ?? false,
      }).catch(() => null);
      if (checked?.kind !== 'sign-in') {
        fail(FAILURES.network);
        return;
      }
      d = checked.discovery;
      discoveryRef.current = d;
      setHosts({ server: hostOf(d.resource), auth: hostOf(d.issuer) });
    }
    await prepare(d);
  }

  function onAction(action: Exclude<OutcomeAction, 'use-key'>): void {
    if (action === 'close') {
      void dropAndClose();
    } else if (action === 'start-again') {
      void startAgain();
    } else if (discoveryRef.current) {
      void prepare(discoveryRef.current);
    } else {
      void startAgain();
    }
  }

  // A reconnect keeps its server, so switching it to a key is not offered from here.
  const isReconnect = argsRef.current.serverId !== undefined;
  const onUseKey =
    props.onUseKey && !isReconnect
      ? () => {
          const p = pendingRef.current;
          pendingRef.current = null;
          if (p) void cancelSignIn(p.state).then(refreshPending);
          props.onUseKey?.(resourceRef.current);
        }
      : undefined;

  let body: JSX.Element;
  switch (step.kind) {
    case 'loading':
      body = <p className="text-sm text-paper-soft">Loading…</p>;
      break;
    case 'preparing':
    case 'confirm':
      body = (
        <SignInConfirm
          serverHost={hosts.server}
          authHost={hosts.auth}
          ready={step.kind === 'confirm'}
          onContinue={onContinue}
          onNotNow={() => void dropAndClose()}
        />
      );
      break;
    case 'waiting':
      body = (
        <SignInWaiting
          finishing={step.finishing}
          canReopen={pendingRef.current?.url != null}
          paste={paste}
          pasteError={pasteError}
          onReopen={openWindow}
          onPaste={onPaste}
          onFinish={() => submit(decodeCallbackPayload(paste))}
          onUseKey={onUseKey}
          onCancel={() => void dropAndClose()}
        />
      );
      break;
    case 'already':
      body = (
        <SignInAlreadyConnected onContinue={() => void connected(step.serverId, step.draft)} />
      );
      break;
    case 'connected':
      body = (
        <p className="text-sm text-emerald-300">
          {step.savingLater ? SAVING_LATER : '● Connected'}
        </p>
      );
      break;
    default:
      body = <SignInOutcome failure={step.failure} onAction={onAction} onUseKey={onUseKey} />;
  }

  if (props.mode === 'page') return body;
  return (
    <OverlayFrame
      label={hosts.server ? `Sign in to ${hosts.server}` : 'Sign in'}
      onClose={props.onClose}
    >
      {body}
    </OverlayFrame>
  );
}

/**
 * The overlay above a chat: focus moves in when it opens and back when it closes, and
 * Escape closes it like the page's Back, keeping a sign-in already opened.
 */
export function OverlayFrame(props: {
  label: string;
  onClose: () => void;
  children: JSX.Element;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fixed layer over the chat, like ConfirmDialog; <dialog> needs showModal(), which would steal the chat's pending approval focus
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
      ref={ref}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 outline-none lg:items-center"
    >
      <div className="w-full max-w-md">{props.children}</div>
    </div>
  );
}
