// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type CheckResult, checkServer } from '../../mcp/oauth/check-server.js';
import { Button } from '../ui/Button.js';

const inputClass =
  'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';
const DIRECT_ONLY =
  "Couldn't reach this server directly. It may only work through a linked Chatsundere server";
const NOT_REACHED = "Couldn't reach this server.";
const RELAY_DOWN = "Couldn't reach your Chatsundere server right now. Try again shortly.";

type Unreachable = Extract<CheckResult, { kind: 'unreachable' }>;

/**
 * Says why a check failed. Only a failed probe gets the "Couldn't reach" sentence; a
 * linked device without its relay is told to wait, an unlinked one where linking helps.
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
 * Everything else appears after the check; *Enter details manually* skips it.
 */
export function CheckServerStep(props: {
  hasProxy: boolean;
  initialLink?: string;
  onResult: (result: Exclude<CheckResult, Unreachable>, link: string) => void;
  onManual: (link: string) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const linked = useAccountLinkStore((s) => s.linkStatus === 'linked');
  const [link, setLink] = useState(props.initialLink ?? '');
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<Unreachable | null>(null);

  async function onCheck(): Promise<void> {
    const target = link.trim();
    if (!target) return;
    setChecking(true);
    setFailure(null);
    try {
      // The Local network toggle lives in the manual path, so the check never asks for it.
      const result = await checkServer(target, { hasProxy: props.hasProxy, allowDirect: false });
      if (result.kind === 'unreachable') setFailure(result);
      else props.onResult(result, target);
    } catch {
      setFailure({ kind: 'unreachable', directOnly: !props.hasProxy, error: '', cause: 'probe' });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
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
          onChange={(e) => {
            setLink(e.target.value);
            setFailure(null);
          }}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={inputClass}
        />
      </div>

      <Button tone="primary" disabled={!link.trim() || checking} onClick={() => void onCheck()}>
        {checking ? 'Checking…' : 'Check server'}
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
