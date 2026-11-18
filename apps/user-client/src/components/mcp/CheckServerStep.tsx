// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type CheckResult, checkServer } from '../../mcp/oauth/check-server.js';
import { Button } from '../ui/Button.js';
import { hostOf } from './sign-in-copy.js';

const inputClass =
  'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';
const DIRECT_ONLY =
  "Couldn't reach this server directly. It may only work through a linked Chatsundere server";
const NOT_REACHED = "Couldn't reach this server.";
const RELAY_DOWN = "Couldn't reach your Chatsundere server right now. Try again shortly.";

type Unreachable = Extract<CheckResult, { kind: 'unreachable' }>;

/** The line that names the host of a link the companion proposed (spec §5.2). */
export function SuggestedInChat(props: { host: string }): JSX.Element {
  return (
    <p className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.06] px-3 py-2 text-xs text-paper">
      {`Suggested in the chat. Check that ${props.host} is the server you want — it will receive what your companion sends to its tools.`}
    </p>
  );
}

/** The host a check contacts, also for a link typed without `https://`. */
function hostOfTyped(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return hostOf(`https://${link}`);
  }
}

/**
 * Says why a check failed. Only a failed probe gets the "Couldn't reach" sentence; a
 * linked device without its relay is told to wait, an unlinked one where linking helps.
 * Every other cause (a refused sign-in, an unusable link, a redirect) carries its own
 * whole sentence in `error`.
 */
function FailureMessage(props: {
  failure: Unreachable;
  linked: boolean;
  onLink: () => void;
}): JSX.Element {
  const { failure } = props;
  if (failure.cause !== 'probe') return <span>{failure.error}</span>;
  if (failure.directOnly && props.linked) return <span>{RELAY_DOWN}</span>;
  if (failure.directOnly) {
    return (
      <>
        <span>{DIRECT_ONLY}</span>
        <Button tone="neutral" className="self-start" onClick={props.onLink}>
          Link a server
        </Button>
      </>
    );
  }
  const detail = failure.error.trim();
  return (
    <span>
      {NOT_REACHED}
      {detail && detail !== NOT_REACHED ? <span className="text-paper-soft"> {detail}</span> : null}
    </span>
  );
}

/**
 * The first screen of *Add server* (spec §9 "Connect"): the link and *Check server*.
 * Everything else appears after the check; *Enter details manually* skips it. With
 * `autoCheck` the initial link is checked once on mount (a link proposed in the chat).
 */
export function CheckServerStep(props: {
  hasProxy: boolean;
  initialLink?: string;
  autoCheck?: boolean;
  suggestedHost?: string | null;
  onLinkEdited?: () => void;
  onResult: (result: Exclude<CheckResult, Unreachable>, link: string) => void;
  onManual: (link: string) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const linked = useAccountLinkStore((s) => s.linkStatus === 'linked');
  const [link, setLink] = useState(props.initialLink ?? '');
  // The host of the link being checked; null while no check runs.
  const [checking, setChecking] = useState<string | null>(null);
  const [failure, setFailure] = useState<Unreachable | null>(null);
  const [edited, setEdited] = useState(false);
  // A ref, not state: StrictMode runs mount effects twice, and the check must run once.
  const autoChecked = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on mount only.
  useEffect(() => {
    if (!props.autoCheck || autoChecked.current) return;
    autoChecked.current = true;
    void onCheck();
  }, []);

  async function onCheck(): Promise<void> {
    const target = link.trim();
    if (!target) return;
    setChecking(hostOfTyped(target));
    setFailure(null);
    try {
      // The Local network toggle lives in the manual path, so the check never asks for it.
      const result = await checkServer(target, { hasProxy: props.hasProxy, allowDirect: false });
      if (result.kind === 'unreachable') setFailure(result);
      else props.onResult(result, target);
    } catch {
      setFailure({ kind: 'unreachable', directOnly: !props.hasProxy, error: '', cause: 'probe' });
    } finally {
      setChecking(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {props.suggestedHost && !edited ? <SuggestedInChat host={props.suggestedHost} /> : null}
      <div>
        <label
          htmlFor="mcp-link"
          className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
        >
          Server link
        </label>
        <input
          id="mcp-link"
          type="url"
          inputMode="url"
          placeholder="https://example.com/mcp"
          value={link}
          readOnly={checking !== null}
          onChange={(e) => {
            setLink(e.target.value);
            setFailure(null);
            if (!edited) {
              setEdited(true);
              props.onLinkEdited?.();
            }
          }}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={inputClass}
        />
      </div>

      <Button
        tone="primary"
        disabled={!link.trim() || checking !== null}
        onClick={() => void onCheck()}
      >
        {checking !== null ? `Checking ${checking}…` : 'Check server'}
      </Button>

      {failure ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-paper">
          <FailureMessage
            failure={failure}
            linked={linked}
            onLink={() => navigate('/app/account/server-linking')}
          />
          <Button tone="neutral" className="self-start" onClick={() => void onCheck()}>
            Try again
          </Button>
        </div>
      ) : null}

      <Button tone="neutral" className="self-start" onClick={() => props.onManual(link.trim())}>
        Enter details manually
      </Button>
      <p className="text-[11px] text-paper-soft">
        For a server on your home network, or one that is down right now, enter the details
        manually.
      </p>
    </div>
  );
}
