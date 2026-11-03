// SPDX-License-Identifier: AGPL-3.0-only
import type { McpOAuthGrantRow } from '../../boot/client-data-db.js';
import { Button } from '../ui/Button.js';
import { SIGN_IN_IN_PROGRESS, SIGN_IN_WAITS_FOR_BACKEND, hostOf } from './sign-in-copy.js';

/**
 * The head of an OAuth server's detail page (spec §9): its state, where it is signed in,
 * a sign-in in progress, and *Sign in again* once the grant has ended. *Sign in again* is
 * disabled while the backend is unreachable, because a new family could compete with a
 * live one on another device.
 */
export function OAuthConnectionPanel(props: {
  status: string;
  grant: McpOAuthGrantRow | undefined;
  signingIn: boolean;
  backendUnreachable: boolean;
  starting: boolean;
  startError: string | null;
  onSignInAgain: () => void;
  onReturnToSignIn: () => void;
}): JSX.Element {
  const { grant } = props;
  const dead = grant !== undefined && grant.tokens === null && !grant.pendingTokens;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="font-display text-sm text-paper">{props.status}</div>
      <div className="text-xs text-paper-soft">
        {grant
          ? `Signed in at ${hostOf(grant.issuer)}`
          : "Signed in on another device. The sign-in hasn't reached this one yet."}
      </div>

      {props.signingIn ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-paper">Sign-in in progress</span>
          <Button tone="neutral" className="self-start" onClick={props.onReturnToSignIn}>
            Return to sign-in
          </Button>
        </div>
      ) : null}

      {dead ? (
        <div className="flex flex-col gap-1">
          <Button
            tone="primary"
            className="self-start"
            disabled={props.backendUnreachable || props.starting || props.signingIn}
            onClick={props.onSignInAgain}
          >
            Sign in again
          </Button>
          {props.signingIn ? (
            <span className="text-xs text-paper-soft">{SIGN_IN_IN_PROGRESS}</span>
          ) : props.backendUnreachable ? (
            <span className="text-xs text-paper-soft">{SIGN_IN_WAITS_FOR_BACKEND}</span>
          ) : null}
          {props.startError ? (
            <span role="alert" className="text-xs text-danger">
              {props.startError}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
