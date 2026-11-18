// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { OAuthSignInFlow } from '../../../components/mcp/OAuthSignInFlow.js';
import { SAVING_LATER, connectedToast, hostOf } from '../../../components/mcp/sign-in-copy.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMcpOAuthGrants } from '../../../data/mcp-oauth-grants.js';
import { usePendingSignIns } from '../../../data/mcp-oauth-pending.js';
import {
  recordMcpConsentForServer,
  useMcpServers,
  useUpsertMcpServer,
} from '../../../data/mcp-servers.js';
import { readReturnTo, withReturn } from '../../../lib/safe-return.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { useAppNav } from '../../../lib/use-app-nav.js';
import { saveConnectedServer, testOAuthConnection } from '../../../mcp/oauth/connect-server.js';
import { type ServerDraft, finishOrphanedSignIns } from '../../../mcp/oauth/sign-in.js';
import { toastStore } from '../../../state/toast.store.js';
import { INTEGRATIONS_CRUMB, INTEGRATIONS_LIST } from './server.js';

/**
 * The waiting screen of a pending sign-in, reached from its row in My Integrations or
 * after unlocking (spec §9 "Leaving and returning"), so the paste field stays reachable.
 */
export function PendingSignInPage(): JSX.Element {
  const { state } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  // The connector card's *Continue sign-in* comes here with the chat it was tapped in.
  const returnTo = readReturnTo(search);
  const nav = useAppNav();
  const { onHelp, helpOverlay } = useHelp('integrations');
  const servers = useMcpServers();
  const grants = useMcpOAuthGrants();
  const pending = usePendingSignIns();
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
        // The grant exists; finishOrphanedSignIns saves the row from the draft. My
        // Integrations runs it on load, but the chat does not, so a return retries here.
        toastStore.show({ message: SAVING_LATER, tone: 'info', durationMs: 6_000 });
        if (returnTo) {
          void finishOrphanedSignIns().catch(() => undefined);
          nav.returnTo(returnTo);
        } else {
          nav.returnTo(INTEGRATIONS_LIST);
        }
        return;
      }
    }
    if (!returnTo) {
      // The waiting screen is done: the server's page takes its place in the history.
      navigate(`/app/integrations/${serverId}`, { replace: true });
      return;
    }
    const row = servers.data?.find((r) => r.id === serverId);
    // A reconnect whose row has not loaded has no name here: its link still gives a host.
    const link =
      pending.data?.find((p) => p.state === state)?.url ??
      grants.data?.find((g) => g.id === serverId)?.resource;
    const name = row?.name ?? draft?.name ?? (link ? hostOf(link) : null);
    // Unknown without the row: promise nothing about the next message then.
    const onByDefault = row?.onByDefault ?? draft?.onByDefault ?? false;
    if (name) {
      toastStore.show({
        message: connectedToast(name, onByDefault),
        tone: 'success',
        durationMs: 6_000,
      });
    }
    nav.returnTo(returnTo);
  }

  return (
    <PageScaffold
      crumbs={[INTEGRATIONS_CRUMB, { label: 'Sign-in' }]}
      back={returnTo ?? INTEGRATIONS_LIST}
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
            navigate(
              withReturn('/app/integrations/new', returnTo),
              link ? { state: { useKeyFor: link } } : undefined,
            )
          }
          onClose={() => nav.returnTo(returnTo ?? INTEGRATIONS_LIST)}
        />
      </div>
    </PageScaffold>
  );
}
