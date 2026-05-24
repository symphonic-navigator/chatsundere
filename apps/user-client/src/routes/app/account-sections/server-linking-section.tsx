// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';

interface Props {
  serverUrl?: string | null;
}

/**
 * Server-linking accordion body. Shows whether this device is linked to a
 * server (Block-1 baseline: never — local-only mode), and a "Link to server"
 * action that hands off to the invitation wizard with a return-URL set to
 * /app/account so its Back button comes home.
 */
export function ServerLinkingSection({ serverUrl }: Props): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
        <div className="text-xs uppercase tracking-widest text-paper-soft">Status</div>
        <div className="mt-1 font-mono text-sm text-paper">
          {serverUrl ? `Linked to ${serverUrl}` : 'Not linked — local-only mode'}
        </div>
      </div>
      <p className="text-[11px] text-paper-soft">
        Link this device to a server to enable cross-device sync (Block 2). Block 1 ships local-only
        — you can run Chatsundere without ever talking to a server.
      </p>
      <button
        type="button"
        onClick={() => navigate('/onboarding/invitation?return=/app/account')}
        className="rounded-md border border-paper px-4 py-2 text-xs uppercase tracking-wider text-paper hover:bg-paper/10"
      >
        Link to server
      </button>
    </div>
  );
}
