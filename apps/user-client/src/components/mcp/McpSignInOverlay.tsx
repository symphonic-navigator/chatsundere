// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { McpServerRow } from '../../boot/client-data-db.js';
import { recordMcpConsent, useMcpServers } from '../../data/mcp-servers.js';
import { useServerGate } from '../../lib/server-gate.js';
import { type CheckResult, checkServer } from '../../mcp/oauth/check-server.js';
import type { OAuthDiscovery } from '../../mcp/oauth/discovery.js';
import {
  type McpSignInTarget,
  useMcpSignInOverlay,
} from '../../state/mcp-sign-in-overlay.store.js';
import { toastStore } from '../../state/toast.store.js';
import { useClass2Gate } from '../../sync/gate.js';
import { OAuthSignInFlow, OverlayFrame } from './OAuthSignInFlow.js';
import { SIGN_IN_WAITS_FOR_BACKEND, reconnectCheckMessage } from './sign-in-copy.js';

type Phase =
  | { kind: 'checking' }
  | { kind: 'flow'; discovery: OAuthDiscovery }
  | { kind: 'error'; message: string };

const CHECKING_FAILED = "Couldn't reach this server to sign in again. Try again in a moment.";

function Reconnect({
  target,
  server,
}: {
  target: McpSignInTarget;
  server: McpServerRow;
}): JSX.Element {
  const close = useMcpSignInOverlay((s) => s.close);
  const hasProxy = useServerGate('proxy').enabled;
  // Backstop for the notice's disabled button: a new family must not race a live one.
  const blocked = useClass2Gate().disabled;
  const [phase, setPhase] = useState<Phase>(
    blocked ? { kind: 'error', message: SIGN_IN_WAITS_FOR_BACKEND } : { kind: 'checking' },
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: one check per opening
  useEffect(() => {
    if (blocked) return undefined;
    let live = true;
    // The same discovery the detail page's *Sign in again* runs, for exactly the row's URL.
    checkServer(server.url, { hasProxy, allowDirect: server.allowDirect, exact: true })
      .then((checked: CheckResult) => {
        if (!live) return;
        if (checked.kind === 'sign-in') setPhase({ kind: 'flow', discovery: checked.discovery });
        else setPhase({ kind: 'error', message: reconnectCheckMessage(checked) });
      })
      .catch(() => {
        if (live) setPhase({ kind: 'error', message: CHECKING_FAILED });
      });
    return () => {
      live = false;
    };
  }, []);

  if (phase.kind === 'flow') {
    return (
      <OAuthSignInFlow
        discovery={phase.discovery}
        serverId={server.id}
        draft={null}
        extraScopes={target.extraScopes}
        mode="overlay"
        onConnected={async () => {
          // Connecting counts as this device's first-use consent (spec §8, M1).
          await recordMcpConsent(server.id, server.url).catch(() => undefined);
          close();
          toastStore.show({
            message: 'Connected. Ask again whenever you like',
            tone: 'success',
            durationMs: 6000,
          });
        }}
        onClose={close}
      />
    );
  }

  return (
    <OverlayFrame label={`Sign in to ${server.name}`} onClose={close}>
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-ink p-4">
        {phase.kind === 'checking' ? (
          <p className="text-sm text-paper-soft">Checking {server.name}…</p>
        ) : (
          <p className="text-sm text-paper">{phase.message}</p>
        )}
      </div>
    </OverlayFrame>
  );
}

/**
 * The sign-in overlay above the chat, mounted once beside the chat page's other layers so
 * the chat, its draft and any pending approval stay mounted underneath (spec §9).
 */
export function McpSignInOverlay(): JSX.Element | null {
  const target = useMcpSignInOverlay((s) => s.target);
  const close = useMcpSignInOverlay((s) => s.close);
  const servers = useMcpServers();
  // Leaving the chat closes the overlay, so it never opens by itself somewhere else.
  useEffect(() => () => useMcpSignInOverlay.getState().close(), []);
  const server = target ? (servers.data ?? []).find((s) => s.id === target.serverId) : undefined;

  if (!target) return null;
  if (!server) {
    // A server removed since the notice was written has nothing to sign in to.
    return (
      <OverlayFrame label="Sign in" onClose={close}>
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-ink p-4">
          <p className="text-sm text-paper">This server is no longer in My Integrations.</p>
        </div>
      </OverlayFrame>
    );
  }
  return <Reconnect key={target.serverId} target={target} server={server} />;
}
