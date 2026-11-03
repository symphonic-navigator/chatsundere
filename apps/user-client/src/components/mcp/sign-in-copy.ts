// SPDX-License-Identifier: AGPL-3.0-only
import type { CheckResult } from '../../mcp/oauth/check-server.js';
import type { CompleteFailure } from '../../mcp/oauth/sign-in.js';
import { OAuthError } from '../../mcp/oauth/url.js';

/** What a failed sign-in screen offers; each maps to one button. */
export type OutcomeAction = 'start-again' | 'try-again' | 'use-key' | 'close';

/** A sign-in that ended without connecting, as the screen shows it. */
export type SignInFailure = { title: string; body: string; actions: OutcomeAction[] };

/** Shown when a sign-in succeeded but saving the server has to wait for the list load. */
export const SAVING_LATER = 'Connected. Saving will finish shortly.';

/** Shown for a pasted code that is malformed or belongs to another sign-in. */
export const CODE_NOT_OURS = "This code doesn't belong to this sign-in.";
/** Shown when finishing needs the key and the app is locked. */
export const UNLOCK_TO_FINISH =
  'Unlock Chatsundere to finish signing in, then paste the code again.';

/** Why a new sign-in waits while the backend is unreachable, on the detail page and in a chat. */
export const SIGN_IN_WAITS_FOR_BACKEND =
  "Signing in again waits until your Chatsundere server is reachable, so it can't clash with your other devices.";

/** Why *Sign in again* is unavailable while this device already has a sign-in open. */
export const SIGN_IN_IN_PROGRESS = 'A sign-in is already in progress';

/** The failure screens, keyed by what went wrong. Raw OAuth codes never appear here. */
export const FAILURES = {
  expired: {
    title: 'Sign-in expired',
    body: "A sign-in stays open for 10 minutes. Start again whenever you're ready.",
    actions: ['start-again'],
  },
  gone: {
    title: 'Sign-in expired',
    body: 'This sign-in has ended or was cancelled. You can start a new one from My Integrations.',
    actions: ['close'],
  },
  cancelled: {
    title: 'Sign-in was cancelled',
    body: 'Nothing was connected. You can start again whenever you like.',
    actions: ['start-again'],
  },
  exchangeFailed: {
    title: "Signing in didn't finish",
    body: 'The code may have run out, or the server turned it down. Starting again is fine.',
    actions: ['start-again'],
  },
  serverProblem: {
    title: "Signing in didn't finish",
    body: 'The server had a problem. Try again shortly.',
    actions: ['start-again'],
  },
  issMismatch: {
    title: "Signing in didn't finish",
    body: 'The code came from a different sign-in service than this server named, so it was refused.',
    actions: ['start-again'],
  },
  approvedAppsOnly: {
    title: 'This server only accepts approved apps',
    body: "Chatsundere can't register itself with this server. If the server gave you a key, you can use that instead.",
    actions: ['use-key', 'close'],
  },
  locked: {
    title: 'Chatsundere is locked',
    body: 'Unlock Chatsundere to sign in, then try again.',
    actions: ['try-again', 'close'],
  },
  network: {
    title: "Couldn't reach the sign-in service",
    body: 'Check your connection and try again.',
    actions: ['try-again', 'close'],
  },
  unusable: {
    title: "Signing in can't start",
    body: "This server's sign-in details can't be used safely, so nothing was sent. If the server gave you a key, you can use that instead.",
    actions: ['use-key', 'close'],
  },
} satisfies Record<string, SignInFailure>;

/** Maps a preparation error to its screen. */
export function prepareFailure(err: unknown): SignInFailure {
  if (!(err instanceof OAuthError)) return FAILURES.network;
  switch (err.kind) {
    case 'locked':
      return FAILURES.locked;
    case 'no-client-identity':
    case 'registration-refused':
      return FAILURES.approvedAppsOnly;
    case 'network':
      return FAILURES.network;
    default:
      return FAILURES.unusable;
  }
}

/** Adds *Back* to a failure that lacks it, so a screen over a chat always has a way out. */
export function withClose(failure: SignInFailure): SignInFailure {
  return failure.actions.includes('close')
    ? failure
    : { ...failure, actions: [...failure.actions, 'close'] };
}

/** Maps a terminal completion failure to its screen; `unknown-state` and `locked` stay on the waiting screen. */
export function completeFailure(
  reason: Exclude<CompleteFailure, 'unknown-state' | 'locked'>,
): SignInFailure {
  switch (reason) {
    case 'cancelled':
      return FAILURES.cancelled;
    case 'expired':
      return FAILURES.expired;
    case 'iss-mismatch':
      return FAILURES.issMismatch;
    case 'approved-apps-only':
      return FAILURES.approvedAppsOnly;
    case 'server-problem':
      return FAILURES.serverProblem;
    default:
      return FAILURES.exchangeFailed;
  }
}

/** The host of a URL for display, or the URL itself when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The sentence for a re-check that did not end in a sign-in, shown on the detail page and over a chat. */
export function reconnectCheckMessage(checked: CheckResult): string {
  if (checked.kind === 'unreachable') {
    return checked.cause !== 'probe'
      ? checked.error
      : "Couldn't reach this server to sign in again. Try again in a moment.";
  }
  return 'This server no longer asks for a sign-in. Remove it and add it again.';
}
