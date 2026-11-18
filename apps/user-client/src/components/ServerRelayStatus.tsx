// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { Link, useLocation } from 'react-router-dom';
import { useServerGate } from '../lib/server-gate.js';

/** Read-only relay status: the authenticated proxy rides on the account link (spec §8). */
export function ServerRelayStatus(): JSX.Element {
  const gate = useServerGate('proxy');
  const issuerLabel = useAccountLinkStore((s) => s.issuerLabel);
  // Server linking's Back returns to the page showing this status, its own
  // `?return=` intact (the return convention).
  const location = useLocation();
  const linkingTo = `/app/account/server-linking?return=${encodeURIComponent(
    `${location.pathname}${location.search}`,
  )}`;
  return (
    <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-widest text-paper-soft">
        Server relay
      </div>
      {gate.enabled ? (
        <p className="text-sm text-paper-soft">
          Providers that need a relay are routed via your linked server
          {issuerLabel ? ` (${issuerLabel})` : ''}.
        </p>
      ) : (
        <p className="text-sm text-paper-soft/70">
          {gate.tooltip}{' '}
          {gate.reason === 'local-only' || gate.reason === 'auth-action' ? (
            <Link className="underline" to={linkingTo}>
              Open server linking
            </Link>
          ) : null}
        </p>
      )}
    </div>
  );
}
