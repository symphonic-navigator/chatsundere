// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { McpServerRow } from '../../boot/client-data-db.js';
import type { CheckResult } from '../../mcp/oauth/check-server.js';
import type { ServerDraft } from '../../mcp/oauth/sign-in.js';
import { canonicalResource } from '../../mcp/oauth/url.js';
import { sanitiseToolName, uniquePrefix } from '../../mcp/tool-naming.js';
import { Button } from '../ui/Button.js';
import { hostOf } from './sign-in-copy.js';

type SignInCheck = Extract<CheckResult, { kind: 'sign-in' }>;

const labelClass = 'mb-1 block text-xs uppercase tracking-widest text-paper-soft';
const inputClass =
  'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';

function sameResource(url: string, resource: string): boolean {
  try {
    return canonicalResource(url) === resource;
  } catch {
    return false;
  }
}

/** The OAuth row already connected to this resource, so a second identity is never made. */
export function existingConnection(
  rows: readonly McpServerRow[],
  resource: string,
): McpServerRow | undefined {
  return rows.find((r) => r.auth?.scheme === 'oauth' && sameResource(r.url, resource));
}

/**
 * The settings shown with a `Sign-in required` result (spec §9 step 2). On by default
 * starts on here, because someone who deliberately signs in wants to use the server.
 */
export function SignInSettings(props: {
  check: SignInCheck;
  rows: readonly McpServerRow[];
  onNext: (draft: ServerDraft) => void;
  onUseKey: () => void;
  onOpenExisting: (id: string) => void;
}): JSX.Element {
  const { check, rows } = props;
  const host = hostOf(check.endpoint);
  const taken = rows.map((r) => r.prefix);
  const [name, setName] = useState(check.discovery.resourceName ?? host);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [onByDefault, setOnByDefault] = useState(true);
  const [autoRun, setAutoRun] = useState(false);
  // A direct answer is the only proof this device can reach the server without a proxy.
  const [allowDirect, setAllowDirect] = useState(check.route === 'direct');
  const effectivePrefix = prefix ?? uniquePrefix(sanitiseToolName(name), taken);

  const existing = existingConnection(rows, check.discovery.resource);
  if (existing) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4">
        <p className="text-sm text-paper">
          You've already connected this server as {existing.name}. Open it to sign in again or
          change its settings.
        </p>
        <Button
          tone="primary"
          className="self-start"
          onClick={() => props.onOpenExisting(existing.id)}
        >
          Open {existing.name}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.06] p-3">
        <div className="font-display text-sm text-paper">Sign-in required</div>
        <p className="text-xs text-paper-soft">
          {host} asks you to sign in before its tools can be used.
        </p>
      </div>

      <div>
        <label htmlFor="mcp-name" className={labelClass}>
          Name
        </label>
        <input
          id="mcp-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="mcp-prefix" className={labelClass}>
          Tool prefix
        </label>
        <input
          id="mcp-prefix"
          type="text"
          value={effectivePrefix}
          onChange={(e) => setPrefix(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-paper-soft">
        <input
          type="checkbox"
          checked={onByDefault}
          onChange={() => setOnByDefault((v) => !v)}
          aria-label="On by default"
        />
        On by default
      </label>

      <label className="flex items-center gap-2 text-xs text-paper-soft">
        <input
          type="checkbox"
          checked={autoRun}
          onChange={() => setAutoRun((v) => !v)}
          aria-label="Trusted — run tools without approval"
        />
        Trusted — run tools without approval
      </label>

      <label
        className="flex items-center gap-2 text-xs text-paper-soft"
        title="Your browser connects straight to the server, which must allow direct browser access (CORS)."
      >
        <input
          type="checkbox"
          checked={allowDirect}
          onChange={() => setAllowDirect((v) => !v)}
          aria-label="Local network — connect directly (must support CORS)"
        />
        Local network <span className="text-paper-soft/60">(must support CORS)</span>
      </label>

      <Button
        tone="primary"
        disabled={!name.trim() || !effectivePrefix}
        onClick={() =>
          props.onNext({
            name: name.trim(),
            prefix: effectivePrefix,
            url: check.endpoint,
            onByDefault,
            autoRun,
            allowDirect,
            routing: check.route,
            resolvedEndpoint: check.endpoint,
          })
        }
      >
        Next
      </Button>

      <Button tone="neutral" className="self-start" onClick={props.onUseKey}>
        Use a key instead
      </Button>
    </div>
  );
}
