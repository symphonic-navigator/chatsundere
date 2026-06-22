// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';

/**
 * Server linking sub-page (`/app/account/server-linking`). Shows the current
 * link status as a read-only Badge and provides a "Link to server" action that
 * hands off to the invitation wizard with a return-URL pointing back here.
 *
 * Block 1 ships local-only — the serverUrl will always be null until sync lands.
 */
export function ServerLinkingPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('server-linking');
  const navigate = useNavigate();

  // Block 1: always local-only. When sync lands, read from app state.
  const serverUrl: string | null = null;

  const statusLabel = serverUrl ? `Linked to ${serverUrl}` : 'Local-only mode';
  const statusTone = serverUrl ? 'success' : 'neutral';

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Server linking' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-6 px-4 pb-8 pt-2">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest text-paper-soft">Status</p>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </div>

        <p className="text-[11px] text-paper-soft">
          Link this device to a server to enable cross-device sync (Block 2). Block 1 ships
          local-only — you can run Chatsundere without ever talking to a server.
        </p>

        <Button
          tone="primary"
          onClick={() => navigate('/onboarding/invitation?return=/app/account/server-linking')}
        >
          Link to server
        </Button>
      </div>
    </PageScaffold>
  );
}
