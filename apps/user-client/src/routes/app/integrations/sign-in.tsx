// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate, useParams } from 'react-router-dom';
import { OAuthSignInFlow } from '../../../components/mcp/OAuthSignInFlow.js';
import { SAVING_LATER } from '../../../components/mcp/sign-in-copy.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  recordMcpConsentForServer,
  useMcpServers,
  useUpsertMcpServer,
} from '../../../data/mcp-servers.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { saveConnectedServer, testOAuthConnection } from '../../../mcp/oauth/connect-server.js';
import type { ServerDraft } from '../../../mcp/oauth/sign-in.js';
import { toastStore } from '../../../state/toast.store.js';

const CRUMB_ROOT = { label: 'My Integrations', to: '/app/integrations' } as const;

/**
 * The waiting screen of a pending sign-in, reached from its row in My Integrations or
 * after unlocking (spec §9 "Leaving and returning"), so the paste field stays reachable.
 */
export function PendingSignInPage(): JSX.Element {
  const { state } = useParams();
  const navigate = useNavigate();
  const { onHelp, helpOverlay } = useHelp('integrations');
  const servers = useMcpServers();
  const hasProxy = useServerGate('proxy').enabled;
  const upsertDeferred = useUpsertMcpServer({ deferWhenOffline: true });

  async function onConnected(serverId: string, draft: ServerDraft | null) {
    if (draft === null) {
      // A reconnect: connecting counts as this device's first-use consent.
      await recordMcpConsentForServer(serverId).catch(() => undefined);
    } else if (!servers.data?.some((r) => r.id === serverId)) {
      try {
        await saveConnectedServer(serverId, draft, {
          upsert: (row) => upsertDeferred.mutateAsync(row),
          test: (row) => testOAuthConnection(row, hasProxy),
        });
      } catch {
        // The grant exists; the list's finishOrphanedSignIns saves the row from the draft.
        toastStore.show({ message: SAVING_LATER, tone: 'info', durationMs: 6_000 });
        navigate('/app/integrations');
        return;
      }
    }
    navigate(`/app/integrations/${serverId}`);
  }

  return (
    <PageScaffold
      crumbs={[CRUMB_ROOT, { label: 'Sign-in' }]}
      back="/app/integrations"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        <OAuthSignInFlow
          key={state}
          state={state ?? ''}
          draft={null}
          mode="page"
          onConnected={(r) => onConnected(r.serverId, r.draft)}
          onUseKey={(link) =>
            navigate('/app/integrations/new', link ? { state: { useKeyFor: link } } : undefined)
          }
          onClose={() => navigate('/app/integrations')}
        />
      </div>
    </PageScaffold>
  );
}
