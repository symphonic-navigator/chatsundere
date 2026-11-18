// SPDX-License-Identifier: AGPL-3.0-only

import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import type { McpServerRow } from '../../../boot/client-data-db.js';
import { CheckServerStep, SuggestedInChat } from '../../../components/mcp/CheckServerStep.js';
import { OAuthConnectionPanel } from '../../../components/mcp/OAuthConnectionPanel.js';
import { OAuthSignInFlow } from '../../../components/mcp/OAuthSignInFlow.js';
import { SignInSettings } from '../../../components/mcp/SignInSettings.js';
import {
  SAVING_LATER,
  addedToast,
  connectedToast,
  hostOf,
  reconnectCheckMessage,
} from '../../../components/mcp/sign-in-copy.js';

/** Why *Remove server* waits for the backend: the delete has to reach every device. */
const REMOVE_WAITS_FOR_BACKEND =
  "Removing this server waits until your Chatsundere server is reachable, so it's removed from all your devices.";
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMcpOAuthGrants } from '../../../data/mcp-oauth-grants.js';
import { usePendingSignIns } from '../../../data/mcp-oauth-pending.js';
import {
  openMcpKey,
  recordMcpConsent,
  sealMcpKey,
  useDeleteMcpServer,
  useMcpServers,
  useUpsertMcpServer,
} from '../../../data/mcp-servers.js';
import { readReturnTo, withReturn } from '../../../lib/safe-return.js';
import { useServerGate } from '../../../lib/server-gate.js';
import { useAppNav } from '../../../lib/use-app-nav.js';
import { testMcpConnection } from '../../../mcp/mcp-connectivity.js';
import { type CheckResult, checkServer } from '../../../mcp/oauth/check-server.js';
import { saveConnectedServer, testOAuthConnection } from '../../../mcp/oauth/connect-server.js';
import type { OAuthDiscovery } from '../../../mcp/oauth/discovery.js';
import { createSignInDeps, waitingScreenPath } from '../../../mcp/oauth/sign-in-session.js';
import {
  type ServerDraft,
  finishOrphanedSignIns,
  removeGrant,
} from '../../../mcp/oauth/sign-in.js';
import { statusOf } from '../../../mcp/server-status.js';
import { sanitiseToolName } from '../../../mcp/tool-naming.js';
import type {
  McpAuthResolved,
  McpConnectionResult,
  McpToolDefinition,
} from '../../../mcp/types.js';
import { toastStore } from '../../../state/toast.store.js';
import { SyncOfflineError } from '../../../sync/enqueue.js';
import { useClass2Gate } from '../../../sync/gate.js';
import { normaliseConnectorLink } from '../../../tools/connector-link.js';

type AuthScheme = 'none' | 'bearer' | 'header';
type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done' };

/** `statusOf`'s line for an OAuth row that needs a server this account has not linked. */
const NEEDS_LINKED_SERVER = '○ Needs a linked Chatsundere server';

/** My Integrations, where the flow's exits go when there is no chat to return to. */
export const INTEGRATIONS_LIST = '/app/integrations';
/** The root crumb of every page under My Integrations. */
export const INTEGRATIONS_CRUMB = { label: 'My Integrations', to: INTEGRATIONS_LIST } as const;

const inputClass =
  'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';

/**
 * Outer shell: resolves the route, loads the servers, and guards the
 * unknown-id case before the inner form seeds its fields. Keeping the data load
 * out here means the form below only mounts once the row is in hand, so an async
 * load can never blank an edit form.
 */
export function IntegrationServerPage(): JSX.Element {
  const { serverId } = useParams();
  const [search] = useSearchParams();
  const returnTo = readReturnTo(search);
  const servers = useMcpServers();
  const { onHelp, helpOverlay } = useHelp('integrations');

  if (serverId && !servers.data) {
    return (
      <PageScaffold
        crumbs={[INTEGRATIONS_CRUMB, { label: 'Loading…' }]}
        back={returnTo ?? INTEGRATIONS_LIST}
        onHelp={onHelp}
      >
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }

  const existing = serverId ? servers.data?.find((r) => r.id === serverId) : undefined;

  if (serverId && !existing) {
    return (
      <PageScaffold
        crumbs={[INTEGRATIONS_CRUMB, { label: 'Unknown' }]}
        back={returnTo ?? INTEGRATIONS_LIST}
        onHelp={onHelp}
      >
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">
          This server is no longer here — go back to My Integrations to pick another.
        </p>
      </PageScaffold>
    );
  }

  if (existing) return <IntegrationServerForm existing={existing} returnTo={returnTo} />;
  return <AddServer rows={servers.data ?? []} returnTo={returnTo} />;
}

/** Seed of the manual form, from a check result or a typed link. */
type FormSeed = {
  url: string;
  authScheme?: AuthScheme;
  allowDirect?: boolean;
  routing?: McpServerRow['routing'];
  resolvedEndpoint?: string | null;
  tools?: McpToolDefinition[];
  /** An open server keeps its auth fields behind a visible *Add a key*. */
  authBehindButton?: boolean;
  dirty?: boolean;
  /** Starting name; after a link proposed in the chat, its host. */
  name?: string;
  /** Starting *On by default*; ticked after a link proposed in the chat. */
  onByDefault?: boolean;
  /** The host of a link proposed in the chat, named above the form. */
  suggestedHost?: string;
};

/** A link the connector card handed over in navigation state, re-validated (spec §5.2). */
type FromChat = { url: string; host: string };

function readProposedLink(state: unknown): FromChat | null {
  const s = state as { useKeyFor?: unknown; proposedLink?: unknown } | null;
  // *Use a key instead* and the card are different callers; the key wins.
  if (typeof s?.useKeyFor === 'string' || typeof s?.proposedLink !== 'string') return null;
  const checked = normaliseConnectorLink(s.proposedLink);
  // `URL.host` keeps a port, as "Checking <host>…" does: one host notion on every screen.
  return checked.ok ? { url: checked.url, host: new URL(checked.url).host } : null;
}

/** The host of a link as typed in the form, or null while it does not parse. */
function hostOfLink(link: string): string | null {
  try {
    return new URL(link.trim()).host;
  } catch {
    return null;
  }
}

type AddPhase =
  | { kind: 'check' }
  | {
      kind: 'sign-in';
      check: Extract<CheckResult, { kind: 'sign-in' }>;
      /** The last draft, kept when the user backs out of the sign-in (050 papercuts, S11). */
      draft?: ServerDraft;
    }
  | { kind: 'flow'; discovery: OAuthDiscovery; draft: ServerDraft; back: AddPhase }
  | { kind: 'form'; seed: FormSeed };

/**
 * *Add server* (spec §9 "Connect"): the link and *Check server* first; the result
 * decides what follows. *Enter details manually* reveals today's whole form.
 */
function AddServer({
  rows,
  returnTo,
}: {
  rows: McpServerRow[];
  returnTo: string | null;
}): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('integrations');
  const navigate = useNavigate();
  const nav = useAppNav();
  const location = useLocation();
  const hasProxy = useServerGate('proxy').enabled;
  const upsertDeferred = useUpsertMcpServer({ deferWhenOffline: true });
  // The waiting screen's *Use a key instead* lands here with the link it was signing in to.
  const keyFor = (location.state as { useKeyFor?: unknown } | null)?.useKeyFor;
  const [phase, setPhase] = useState<AddPhase>(
    typeof keyFor === 'string'
      ? { kind: 'form', seed: { url: keyFor, authScheme: 'bearer' } }
      : { kind: 'check' },
  );
  // Kept here, not in history: the state is consumed below, and an edit of the link drops it.
  const [fromChat, setFromChat] = useState<FromChat | null>(() => readProposedLink(location.state));
  const [link, setLink] = useState(fromChat?.url ?? '');

  // Consumed at once, so a reload or Back/Forward into this entry never re-runs the check.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on arrival only.
  useEffect(() => {
    const proposed = (location.state as { proposedLink?: unknown } | null)?.proposedLink;
    if (proposed !== undefined && typeof keyFor !== 'string') {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, []);

  if (phase.kind === 'form') return <IntegrationServerForm seed={phase.seed} returnTo={returnTo} />;

  // The form that follows a proposal starts named after the host, and on by default (§5.3).
  const proposalSeed = (): Partial<FormSeed> =>
    fromChat ? { name: fromChat.host, onByDefault: true, suggestedHost: fromChat.host } : {};

  function onResult(result: Exclude<CheckResult, { kind: 'unreachable' }>, checked: string) {
    setLink(checked);
    const allowDirect = result.route === 'direct';
    if (result.kind === 'sign-in') {
      setPhase({ kind: 'sign-in', check: result });
    } else if (result.kind === 'key') {
      setPhase({
        kind: 'form',
        seed: { url: result.endpoint, authScheme: 'bearer', allowDirect, ...proposalSeed() },
      });
    } else {
      setPhase({
        kind: 'form',
        seed: {
          ...proposalSeed(),
          url: result.endpoint,
          allowDirect,
          routing: result.route,
          resolvedEndpoint: result.endpoint,
          tools: result.tools,
          authBehindButton: true,
          dirty: true,
        },
      });
    }
  }

  async function onConnected(serverId: string, draft: ServerDraft | null) {
    if (draft && !rows.some((r) => r.id === serverId)) {
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
      // The add form is done: the server's page takes its place in the history.
      navigate(`/app/integrations/${serverId}`, { replace: true });
      return;
    }
    const row = rows.find((r) => r.id === serverId);
    const name = row?.name ?? draft?.name ?? hostOfLink(link);
    const onByDefault = row?.onByDefault ?? draft?.onByDefault ?? false;
    if (name) {
      toastStore.show({
        message: connectedToast(name, onByDefault),
        tone: 'success',
        durationMs: 6_000,
      });
    }
    // Unwind to the chat the card was tapped in, rather than stacking a second one.
    nav.returnTo(returnTo);
  }

  return (
    <PageScaffold
      crumbs={[INTEGRATIONS_CRUMB, { label: 'Add MCP server' }]}
      back={returnTo ?? INTEGRATIONS_LIST}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        {phase.kind === 'check' ? (
          <CheckServerStep
            hasProxy={hasProxy}
            initialLink={link}
            autoCheck={fromChat !== null}
            suggestedHost={fromChat?.host ?? null}
            returnTo={returnTo}
            onLinkEdited={() => setFromChat(null)}
            onResult={onResult}
            onManual={(typed) =>
              setPhase({ kind: 'form', seed: { url: typed, ...proposalSeed() } })
            }
          />
        ) : null}
        {phase.kind === 'sign-in' ? (
          <SignInSettings
            check={phase.check}
            rows={rows}
            initial={phase.draft}
            suggestedHost={fromChat?.host ?? null}
            onNext={(draft) =>
              setPhase({
                kind: 'flow',
                discovery: phase.check.discovery,
                draft,
                back: { kind: 'sign-in', check: phase.check, draft },
              })
            }
            onUseKey={() =>
              setPhase({
                kind: 'form',
                seed: { url: phase.check.endpoint, authScheme: 'bearer', ...proposalSeed() },
              })
            }
            onOpenExisting={(id) => navigate(withReturn(`/app/integrations/${id}`, returnTo))}
          />
        ) : null}
        {phase.kind === 'flow' ? (
          <OAuthSignInFlow
            discovery={phase.discovery}
            draft={phase.draft}
            mode="page"
            onConnected={(r) => onConnected(r.serverId, r.draft)}
            onUseKey={() =>
              setPhase({
                kind: 'form',
                seed: { url: phase.draft.url, authScheme: 'bearer', ...proposalSeed() },
              })
            }
            onClose={() => setPhase(phase.back)}
          />
        ) : null}
      </div>
    </PageScaffold>
  );
}

/** Inner form: add (existing undefined, seeded by the check) or edit a single MCP server. */
function IntegrationServerForm({
  existing,
  seed,
  returnTo,
}: {
  existing?: McpServerRow;
  seed?: FormSeed;
  /** Where every exit goes when the page was opened from a chat (spec §5.5). */
  returnTo: string | null;
}): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('integrations');
  const navigate = useNavigate();
  const nav = useAppNav();
  const proxyGate = useServerGate('proxy');
  const upsert = useUpsertMcpServer();
  const del = useDeleteMcpServer();
  const mk = useSessionStore((s) => s.mk);
  // An OAuth row has no secret here; its grant is its own synced row (spec §4.2).
  const isOAuth = existing?.auth?.scheme === 'oauth';

  const [name, setName] = useState(existing?.name ?? seed?.name ?? '');
  const [url, setUrl] = useState(existing?.url ?? seed?.url ?? '');
  // Once the link no longer points at the suggested host, the line goes for good.
  const [suggestionKept, setSuggestionKept] = useState(true);
  const [prefix, setPrefix] = useState(existing?.prefix ?? '');
  const [prefixEdited, setPrefixEdited] = useState(existing != null);
  const [authScheme, setAuthScheme] = useState<AuthScheme>(
    existing?.auth && existing.auth.scheme !== 'oauth'
      ? existing.auth.scheme
      : (seed?.authScheme ?? 'none'),
  );
  const [authShown, setAuthShown] = useState(!seed?.authBehindButton);
  const [headerName, setHeaderName] = useState(
    existing?.auth?.scheme === 'header' ? existing.auth.headerName : '',
  );
  const [keyInput, setKeyInput] = useState('');
  const [onByDefault, setOnByDefault] = useState(
    existing?.onByDefault ?? seed?.onByDefault ?? false,
  );
  const [autoRun, setAutoRun] = useState(existing?.autoRun ?? false);
  const [allowDirect, setAllowDirect] = useState(
    existing?.allowDirect ?? seed?.allowDirect ?? false,
  );

  const [routing, setRouting] = useState<McpServerRow['routing']>(
    existing?.routing ?? seed?.routing ?? null,
  );
  const [resolvedEndpoint, setResolvedEndpoint] = useState<string | null>(
    existing?.resolvedEndpoint ?? seed?.resolvedEndpoint ?? null,
  );
  const [tools, setTools] = useState<McpToolDefinition[]>(existing?.tools ?? seed?.tools ?? []);
  const [hiddenTools, setHiddenTools] = useState<string[]>(existing?.hiddenTools ?? []);
  const [lastError, setLastError] = useState<string | null>(existing?.lastError ?? null);
  const [lastTestedAt, setLastTestedAt] = useState<number | null>(existing?.lastTestedAt ?? null);
  const [routingChangedHint, setRoutingChangedHint] = useState(false);

  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  // A test outcome that is no connection result, so it never reaches `lastError`.
  const [testNote, setTestNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(seed?.dirty ?? false);
  const [removing, setRemoving] = useState(false);
  const [reconnect, setReconnect] = useState<
    { kind: 'idle' } | { kind: 'checking' } | { kind: 'flow'; discovery: OAuthDiscovery }
  >({ kind: 'idle' });
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const grants = useMcpOAuthGrants();
  const pending = usePendingSignIns();
  const linked = useAccountLinkStore((s) => s.linkStatus === 'linked');
  const class2 = useClass2Gate();
  const grant = existing ? (grants.data ?? []).find((g) => g.id === existing.id) : undefined;
  const pendingHere = existing
    ? (pending.data ?? []).find((p) => p.serverId === existing.id)
    : undefined;
  const oauthStatus =
    isOAuth && existing
      ? statusOf(existing, {
          hasProxy: proxyGate.enabled,
          linked,
          grant,
          signingIn: pendingHere !== undefined,
        })
      : null;
  // Only the local-only reason has a fix here; a linked server that is offline does not.
  const offerLinking = !linked && oauthStatus === NEEDS_LINKED_SERVER;

  const effectivePrefix = prefixEdited ? prefix : sanitiseToolName(name);
  const back = () => nav.returnTo(returnTo ?? INTEGRATIONS_LIST);

  function buildAuth(key: string | null): McpAuthResolved | null {
    if (!key) return null;
    if (authScheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
    if (authScheme === 'header' && headerName) return { header: headerName, value: key };
    return null;
  }

  // `tools` is synced and proves to other devices that this server connects, so
  // only a new URL drops it; a changed key or a failed test clears just this device's route.
  function clearTestResult() {
    setRouting(null);
    setResolvedEndpoint(null);
    setLastTestedAt(null);
    setLastError(null);
    setTestNote(null);
    setTest({ kind: 'idle' });
  }

  async function onTest() {
    if (!mk || !url) return;
    setError(null);
    setTestNote(null);
    setRoutingChangedHint(false);
    setTest({ kind: 'testing' });
    try {
      const hasProxy = proxyGate.enabled;
      // An OAuth row whose tokens are renewed through the proxy needs it even when direct.
      const oauthNeedsProxy = isOAuth && grant?.tokenRoute === 'proxy';
      if (isOAuth && !hasProxy && (!allowDirect || oauthNeedsProxy)) {
        setLastError(
          linked
            ? "Your Chatsundere server can't be reached right now, and this server connects through it. Test again once it's back."
            : 'This server connects through a linked Chatsundere server. Link one first.',
        );
        setTest({ kind: 'done' });
        return;
      }
      if (!allowDirect && !hasProxy) {
        setLastError(
          'The linked server relay is unavailable. Turn on Local network to connect directly, or link a server first.',
        );
        setTest({ kind: 'done' });
        return;
      }

      if (isOAuth && existing) {
        const result = await testOAuthConnection({ ...existing, allowDirect }, hasProxy);
        applyTestResult(result);
        // A successful test counts as this device's first-use consent (spec §8, M1).
        if (result.ok) await recordMcpConsent(existing.id, existing.url);
        return;
      }

      const plaintextKey =
        authScheme === 'none'
          ? null
          : keyInput
            ? keyInput
            : existing
              ? await openMcpKey(existing, mk)
              : null;
      const auth = buildAuth(plaintextKey);

      const result = await testMcpConnection({ url, hasProxy, allowDirect, auth });
      applyTestResult(result);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
      setTest({ kind: 'done' });
    }
  }

  function applyTestResult(result: McpConnectionResult) {
    // A paused grant tells nothing about the route, so the row's last result stays to save.
    if (result.held) {
      setTestNote(result.error);
      setTest({ kind: 'done' });
      return;
    }
    setTestNote(null);
    setRouting(result.routing);
    setResolvedEndpoint(result.resolvedEndpoint);
    if (result.ok) setTools(result.tools);
    setLastError(result.error);
    setLastTestedAt(Date.now());
    setTest({ kind: 'done' });
    // A new result lives only in this form until Save, so leaving must not lose it
    // silently; re-checking a healthy server has nothing to save and must not nag.
    const unchanged =
      result.routing === (existing?.routing ?? null) &&
      result.resolvedEndpoint === (existing?.resolvedEndpoint ?? null) &&
      JSON.stringify(result.tools) === JSON.stringify(existing?.tools ?? []);
    if (result.ok && !unchanged) setDirty(true);
  }

  function onToggleAllowDirect() {
    setDirty(true);
    setAllowDirect((v) => !v);
    setRoutingChangedHint(routing !== null || resolvedEndpoint !== null);
    setRouting(null);
    setResolvedEndpoint(null);
    setLastError(null);
    setLastTestedAt(null);
    setTest({ kind: 'idle' });
  }

  function toggleHidden(toolName: string) {
    setDirty(true);
    setHiddenTools((prev) =>
      prev.includes(toolName) ? prev.filter((n) => n !== toolName) : [...prev, toolName],
    );
  }

  async function onSave() {
    if (!mk) {
      setError('No master key in session — re-login required.');
      return;
    }
    if (!name || !url) {
      setError('Name and URL are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const id = existing?.id ?? uuidv7();

      // Saving must never disturb the grant (spec §9): an OAuth row keeps its scheme.
      let auth: McpServerRow['auth'] = null;
      if (isOAuth) {
        auth = { scheme: 'oauth' };
      } else if (authScheme === 'bearer') {
        const sealed = keyInput
          ? await sealMcpKey(keyInput, mk, id)
          : existing?.auth?.scheme === 'bearer'
            ? existing.auth.key
            : null;
        auth = sealed ? { scheme: 'bearer', key: sealed } : null;
      } else if (authScheme === 'header') {
        const sealed = keyInput
          ? await sealMcpKey(keyInput, mk, id)
          : existing?.auth?.scheme === 'header'
            ? existing.auth.key
            : null;
        auth = sealed && headerName ? { scheme: 'header', headerName, key: sealed } : null;
      }

      const now = Date.now();
      const row: McpServerRow = {
        id,
        name,
        url,
        prefix: effectivePrefix,
        auth,
        onByDefault,
        autoRun,
        allowDirect,
        enabled: true,
        routing,
        resolvedEndpoint,
        tools,
        hiddenTools,
        lastTestedAt,
        lastError,
        firstUseConsentFor: existing?.url === url ? (existing.firstUseConsentFor ?? null) : null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await upsert.mutateAsync(row);
      setDirty(false);
      if (returnTo && !existing) {
        toastStore.show({
          message: addedToast(name, onByDefault),
          tone: 'success',
          durationMs: 6_000,
        });
      }
      // Save leaves the way ‹ does, or to the chat it came from; Remove goes up to the list.
      if (returnTo) nav.returnTo(returnTo);
      else nav.back(INTEGRATIONS_LIST);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onSignInAgain() {
    if (!existing) return;
    setReconnectError(null);
    setReconnect({ kind: 'checking' });
    try {
      const checked = await checkServer(existing.url, {
        hasProxy: proxyGate.enabled,
        allowDirect: existing.allowDirect,
        // Exactly the row's URL: the new grant's resource must be it (spec §7).
        exact: true,
      });
      if (checked.kind === 'sign-in') {
        setReconnect({ kind: 'flow', discovery: checked.discovery });
        return;
      }
      setReconnectError(reconnectCheckMessage(checked));
    } catch {
      setReconnectError("Couldn't reach this server to sign in again. Try again in a moment.");
    }
    setReconnect({ kind: 'idle' });
  }

  async function onReconnected() {
    if (!existing) return;
    setReconnect({ kind: 'idle' });
    // Connecting counts as this device's first-use consent (spec §8, M1).
    await recordMcpConsent(existing.id, existing.url).catch(() => undefined);
    void onTest();
  }

  async function onRemove() {
    if (!existing) return;
    if (!isOAuth) {
      del.mutate(existing.id);
      back();
      return;
    }
    setRemoving(true);
    try {
      const { revoked } = await removeGrant(existing.id, await createSignInDeps());
      if (!revoked) {
        toastStore.show({
          message: `${existing.name} is removed, but Chatsundere couldn't sign out at ${signInHost}. The server may still list it as signed in until that sign-in runs out.`,
          tone: 'warn',
          durationMs: 10_000,
        });
      }
      back();
    } catch (e) {
      setError(
        e instanceof SyncOfflineError
          ? "Your Chatsundere server can't be reached, so this server can't be removed from all your devices yet. Try again once it's back."
          : "This server couldn't be removed. Try again in a moment.",
      );
    } finally {
      setRemoving(false);
    }
  }

  const signInHost = grant ? hostOf(grant.issuer) : hostOf(existing?.url ?? url);

  if (existing && reconnect.kind === 'flow') {
    const detail = `/app/integrations/${existing.id}`;
    return (
      <PageScaffold
        crumbs={[
          INTEGRATIONS_CRUMB,
          { label: existing.name, to: detail },
          { label: 'Sign in again' },
        ]}
        back={detail}
        // The flow shares the detail page's route, so going "there" means leaving the flow;
        // an opened sign-in stays pending, as the flow's own Back keeps it.
        onNavigate={(move) =>
          move.kind === 'back' || move.to === detail
            ? setReconnect({ kind: 'idle' })
            : nav.returnTo(move.to)
        }
        onHelp={onHelp}
      >
        {helpOverlay}
        <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
          <OAuthSignInFlow
            discovery={reconnect.discovery}
            serverId={existing.id}
            draft={null}
            mode="page"
            onConnected={() => onReconnected()}
            onClose={() => setReconnect({ kind: 'idle' })}
          />
        </div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      crumbs={[INTEGRATIONS_CRUMB, { label: existing ? existing.name : 'Add MCP server' }]}
      back={returnTo ?? INTEGRATIONS_LIST}
      onHelp={onHelp}
      dirty={dirty}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        {isOAuth && existing ? (
          <OAuthConnectionPanel
            status={oauthStatus ?? ''}
            grant={grant}
            signingIn={pendingHere !== undefined}
            backendUnreachable={class2.disabled}
            starting={reconnect.kind === 'checking'}
            startError={reconnectError}
            onSignInAgain={() => void onSignInAgain()}
            onReturnToSignIn={() =>
              pendingHere && navigate(withReturn(waitingScreenPath(pendingHere.state), returnTo))
            }
          />
        ) : null}
        {seed?.suggestedHost && !existing && suggestionKept ? (
          <SuggestedInChat host={seed.suggestedHost} />
        ) : null}
        {existing && offerLinking ? (
          <Button
            tone="primary"
            className="self-start"
            onClick={() =>
              navigate(
                withReturn(
                  '/app/account/server-linking',
                  withReturn(`/app/integrations/${existing.id}`, returnTo),
                ),
              )
            }
          >
            Link a server
          </Button>
        ) : null}

        <div>
          <label
            htmlFor="mcp-name"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            Name
          </label>
          <input
            id="mcp-name"
            type="text"
            placeholder="My tool server"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="mcp-url"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            URL
          </label>
          <input
            id="mcp-url"
            type="text"
            placeholder="https://example.com/mcp"
            value={url}
            readOnly={isOAuth}
            aria-describedby={isOAuth ? 'mcp-url-reason' : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              if (hostOfLink(e.target.value) !== seed?.suggestedHost) setSuggestionKept(false);
              setDirty(true);
              clearTestResult();
              setTools([]);
            }}
            autoComplete="off"
            className={`${inputClass}${isOAuth ? ' opacity-70' : ''}`}
          />
          {isOAuth ? (
            <p id="mcp-url-reason" className="mt-1 text-[11px] text-paper-soft">
              To change the link, remove this server and connect it again
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="mcp-prefix"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            Tool prefix
          </label>
          <input
            id="mcp-prefix"
            type="text"
            placeholder="prefix"
            value={effectivePrefix}
            onChange={(e) => {
              setPrefixEdited(true);
              setPrefix(e.target.value);
              setDirty(true);
            }}
            autoComplete="off"
            className={inputClass}
          />
        </div>

        {!isOAuth && !authShown ? (
          <Button tone="neutral" className="self-start" onClick={() => setAuthShown(true)}>
            Add a key
          </Button>
        ) : null}

        {!isOAuth && authShown ? (
          <>
            <div>
              <label
                htmlFor="mcp-auth"
                className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
              >
                Authentication
              </label>
              <select
                id="mcp-auth"
                value={authScheme}
                onChange={(e) => {
                  setAuthScheme(e.target.value as AuthScheme);
                  setDirty(true);
                  clearTestResult();
                }}
                className={inputClass}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">Custom header</option>
              </select>
            </div>

            {authScheme === 'header' ? (
              <div>
                <label
                  htmlFor="mcp-header-name"
                  className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
                >
                  Header name
                </label>
                <input
                  id="mcp-header-name"
                  type="text"
                  placeholder="X-API-Key"
                  value={headerName}
                  onChange={(e) => {
                    setHeaderName(e.target.value);
                    setDirty(true);
                  }}
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
            ) : null}

            {authScheme !== 'none' ? (
              <div>
                <label
                  htmlFor="mcp-key"
                  className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
                >
                  Key
                </label>
                <input
                  id="mcp-key"
                  type="password"
                  placeholder={
                    existing != null && existing.auth?.scheme === authScheme
                      ? 'leave blank to keep current'
                      : 'token or key'
                  }
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setDirty(true);
                    clearTestResult();
                  }}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  name=""
                  className={inputClass}
                />
              </div>
            ) : null}
          </>
        ) : null}

        <label className="flex items-center gap-2 text-xs text-paper-soft">
          <input
            type="checkbox"
            checked={onByDefault}
            onChange={() => {
              setOnByDefault((v) => !v);
              setDirty(true);
            }}
            aria-label="On by default"
          />
          On by default
        </label>

        <label className="flex items-center gap-2 text-xs text-paper-soft">
          <input
            type="checkbox"
            checked={autoRun}
            onChange={() => {
              setAutoRun((v) => !v);
              setDirty(true);
            }}
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
            onChange={onToggleAllowDirect}
            aria-label="Local network — connect directly (must support CORS)"
          />
          Local network <span className="text-paper-soft/60">(must support CORS)</span>
        </label>

        <Button
          tone="neutral"
          onClick={() => void onTest()}
          disabled={!mk || !url || test.kind === 'testing'}
          title={!mk ? 'Unlock to test' : undefined}
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>

        {test.kind === 'done' && testNote ? (
          <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.06] px-3 py-2 text-xs text-paper-soft">
            {testNote}
          </div>
        ) : null}

        {test.kind === 'done' && !testNote && lastError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            ✗ {lastError}
          </div>
        ) : null}

        {test.kind === 'done' && !testNote && !lastError && routing ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            ● Connected ({routing === 'proxy' ? 'via proxy' : 'direct'}) · {resolvedEndpoint}
          </div>
        ) : null}

        {routingChangedHint && test.kind === 'idle' ? (
          <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.06] px-3 py-2 text-xs text-paper-soft">
            Routing changed — re-test the connection.
          </div>
        ) : null}

        {tools.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
              Tools ({tools.length})
            </div>
            <div className="flex flex-col gap-1">
              {tools.map((tool) => (
                <label
                  key={tool.name}
                  className="flex items-start gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-xs text-paper"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenTools.includes(tool.name)}
                    onChange={() => toggleHidden(tool.name)}
                    aria-label={`Enable tool ${tool.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono">{tool.name}</span>
                    {tool.description ? (
                      <span className="block text-[11px] text-paper-soft">{tool.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            ✗ {error}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            tone="primary"
            onClick={() => void onSave()}
            disabled={!mk || saving}
            title={!mk ? 'Unlock to save' : undefined}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {dirty ? <Badge tone="warning">● Unsaved</Badge> : null}
        </div>

        {existing ? (
          <div className="flex flex-col gap-1">
            <Button
              tone="destructive"
              className="self-start"
              disabled={removing || (isOAuth && class2.disabled)}
              aria-describedby={isOAuth && class2.disabled ? 'mcp-remove-reason' : undefined}
              onClick={() => setConfirmDelete(true)}
            >
              {removing ? 'Removing…' : 'Remove server'}
            </Button>
            {isOAuth && class2.disabled ? (
              <span id="mcp-remove-reason" className="text-xs text-paper-soft">
                {REMOVE_WAITS_FOR_BACKEND}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${existing?.name ?? ''}?`}
        body={
          isOAuth
            ? `This removes the server from all your devices and signs Chatsundere out at ${signInHost}. Personas lose access to its tools.`
            : 'The server and its stored key are deleted. Personas lose access to its tools.'
        }
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void onRemove();
        }}
      />
    </PageScaffold>
  );
}
