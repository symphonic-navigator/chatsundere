// SPDX-License-Identifier: AGPL-3.0-only
import { Button } from '../ui/Button.js';
import type { OutcomeAction, SignInFailure } from './sign-in-copy.js';

const noteClass = 'text-xs text-paper-soft';
const cardClass = 'flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4';
const headingClass = 'font-display text-lg text-paper';
const inputClass =
  'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';

/** Disabled with its reason beside it, never hidden (CLAUDE.md §11). */
function UseKeyButton({ onUseKey }: { onUseKey: (() => void) | undefined }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <Button
        tone="neutral"
        className="self-start"
        disabled={!onUseKey}
        onClick={() => onUseKey?.()}
      >
        Use a key instead
      </Button>
      {onUseKey ? null : (
        <span className={noteClass}>
          To use a key, remove this server and add it again with the key.
        </span>
      )}
    </div>
  );
}

/** Step 3 of spec §9: who you sign in with, where it applies, and the one gesture. */
export function SignInConfirm(props: {
  serverHost: string;
  authHost: string;
  /** Only a linked account shares the grant with other devices. */
  linked: boolean;
  ready: boolean;
  onContinue: () => void;
  onNotNow: () => void;
}): JSX.Element {
  return (
    <div className={cardClass}>
      <h2 className={headingClass}>Sign in to {props.serverHost}</h2>
      <p className="text-sm text-paper">
        {props.serverHost} asks you to sign in.{' '}
        {props.authHost === props.serverHost
          ? `You'll sign in at ${props.authHost}.`
          : `You'll sign in at ${props.authHost}, which is not ${props.serverHost}.`}
      </p>
      {props.linked ? (
        <p className={noteClass}>Access applies on all your devices that use this account.</p>
      ) : null}
      <p className={noteClass}>
        Only connect servers you trust: their tools see what your Circle sends them.
      </p>
      <Button tone="primary" priority disabled={!props.ready} onClick={props.onContinue}>
        Continue to sign-in
      </Button>
      {props.ready ? null : <span className={noteClass}>Getting the sign-in ready…</span>}
      <Button tone="neutral" className="self-start" onClick={props.onNotNow}>
        Not now
      </Button>
    </div>
  );
}

/** Step 4 of spec §9: the waiting screen, with its paste field always visible. */
export function SignInWaiting(props: {
  finishing: boolean;
  canReopen: boolean;
  paste: string;
  pasteError: string | null;
  onReopen: () => void;
  onPaste: (value: string) => void;
  onFinish: () => void;
  onUseKey: (() => void) | undefined;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className={cardClass}>
      <h2 className={headingClass}>
        {props.finishing ? 'Finishing sign-in…' : 'Waiting for sign-in…'}
      </h2>
      <p className={noteClass}>
        Sign in in the window that opened. This screen carries on by itself when you're done.
      </p>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-paper">Nothing opened?</span>
        <Button
          tone="neutral"
          className="self-start"
          disabled={!props.canReopen || props.finishing}
          onClick={props.onReopen}
        >
          Open sign-in again
        </Button>
        {props.canReopen ? null : (
          <span className={noteClass}>
            This sign-in can't be reopened here. Cancel and start again.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="mcp-oauth-paste" className="text-sm text-paper">
          Sign-in showed you a code?
        </label>
        <input
          id="mcp-oauth-paste"
          type="text"
          value={props.paste}
          placeholder="Paste the code here"
          onChange={(e) => props.onPaste(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={props.finishing}
          className={inputClass}
        />
        {props.pasteError ? (
          <span role="alert" className="text-xs text-danger">
            {props.pasteError}
          </span>
        ) : null}
        <Button
          tone="neutral"
          className="self-start"
          disabled={props.finishing}
          onClick={props.onFinish}
        >
          Finish
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <span className={noteClass}>
          Did the sign-in page show an error? Some servers only accept approved apps.
        </span>
        <UseKeyButton onUseKey={props.onUseKey} />
      </div>

      <Button tone="neutral" className="self-start" onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** A sign-in that ended without connecting, with what can be done next. */
export function SignInOutcome(props: {
  failure: SignInFailure;
  onAction: (action: Exclude<OutcomeAction, 'use-key'>) => void;
  onUseKey: (() => void) | undefined;
}): JSX.Element {
  const { failure } = props;
  return (
    <div className={cardClass}>
      <h2 className={headingClass}>{failure.title}</h2>
      <p className="text-sm text-paper-soft">{failure.body}</p>
      {failure.actions.map((a) =>
        a === 'use-key' ? (
          <UseKeyButton key={a} onUseKey={props.onUseKey} />
        ) : (
          <Button
            key={a}
            tone={a === 'close' ? 'neutral' : 'primary'}
            className="self-start"
            onClick={() => props.onAction(a)}
          >
            {a === 'start-again' ? 'Start again' : a === 'try-again' ? 'Try again' : 'Back'}
          </Button>
        ),
      )}
    </div>
  );
}

/** A re-pasted code for a sign-in that already finished. */
export function SignInAlreadyConnected({ onContinue }: { onContinue: () => void }): JSX.Element {
  return (
    <div className={cardClass}>
      <h2 className={headingClass}>Already connected</h2>
      <p className="text-sm text-paper-soft">This sign-in has already finished.</p>
      <Button tone="primary" className="self-start" onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}
