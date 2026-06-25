// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import type { McpServerRow } from '../../../boot/client-data-db.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  openMcpKey,
  sealMcpKey,
  useDeleteMcpServer,
  useMcpServers,
  useUpsertMcpServer,
} from '../../../data/mcp-servers.js';
import { useSettings } from '../../../data/settings.js';
import { openSecret } from '../../../lib/secrets.js';
import { testMcpConnection } from '../../../mcp/mcp-connectivity.js';
import { sanitiseToolName } from '../../../mcp/tool-naming.js';
import type { McpAuthResolved, McpToolDefinition } from '../../../mcp/types.js';

type AuthScheme = 'none' | 'bearer' | 'header';
type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done' };

const CRUMB_ROOT = { label: 'My Integrations', to: '/app/integrations' } as const;
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
  const servers = useMcpServers();
  const { onHelp, helpOverlay } = useHelp('integrations');

  if (serverId && !servers.data) {
    return (
      <PageScaffold
        crumbs={[CRUMB_ROOT, { label: 'Loading…' }]}
        back="/app/integrations"
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
        crumbs={[CRUMB_ROOT, { label: 'Unknown' }]}
        back="/app/integrations"
        onHelp={onHelp}
      >
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">
          This server is no longer here — go back to My Integrations to pick another.
        </p>
      </PageScaffold>
    );
  }

  return <IntegrationServerForm existing={existing} />;
}

/** Inner form: add (existing undefined) or edit a single MCP server. */
function IntegrationServerForm({ existing }: { existing?: McpServerRow }): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('integrations');
  const navigate = useNavigate();
  const settings = useSettings();
  const upsert = useUpsertMcpServer();
  const del = useDeleteMcpServer();
  const mk = useSessionStore((s) => s.mk);

  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [prefix, setPrefix] = useState(existing?.prefix ?? '');
  const [prefixEdited, setPrefixEdited] = useState(existing != null);
  const [authScheme, setAuthScheme] = useState<AuthScheme>(existing?.auth?.scheme ?? 'none');
  const [headerName, setHeaderName] = useState(
    existing?.auth?.scheme === 'header' ? existing.auth.headerName : '',
  );
  const [keyInput, setKeyInput] = useState('');
  const [onByDefault, setOnByDefault] = useState(existing?.onByDefault ?? false);
  const [autoRun, setAutoRun] = useState(existing?.autoRun ?? false);
  const [allowDirect, setAllowDirect] = useState(existing?.allowDirect ?? false);

  const [routing, setRouting] = useState<McpServerRow['routing']>(existing?.routing ?? null);
  const [resolvedEndpoint, setResolvedEndpoint] = useState<string | null>(
    existing?.resolvedEndpoint ?? null,
  );
  const [tools, setTools] = useState<McpToolDefinition[]>(existing?.tools ?? []);
  const [hiddenTools, setHiddenTools] = useState<string[]>(existing?.hiddenTools ?? []);
  const [lastError, setLastError] = useState<string | null>(existing?.lastError ?? null);
  const [lastTestedAt, setLastTestedAt] = useState<number | null>(existing?.lastTestedAt ?? null);
  const [routingChangedHint, setRoutingChangedHint] = useState(false);

  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const effectivePrefix = prefixEdited ? prefix : sanitiseToolName(name);
  const back = () => navigate('/app/integrations');

  function buildAuth(key: string | null): McpAuthResolved | null {
    if (!key) return null;
    if (authScheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
    if (authScheme === 'header' && headerName) return { header: headerName, value: key };
    return null;
  }

  function clearTestResult() {
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
    setLastTestedAt(null);
    setLastError(null);
    setTest({ kind: 'idle' });
  }

  async function onTest() {
    if (!mk || !url) return;
    setError(null);
    setRoutingChangedHint(false);
    setTest({ kind: 'testing' });
    try {
      const sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
      const hasProxy = settings.data?.corsProxy != null;
      if (!allowDirect && !hasProxy) {
        setLastError(
          'No CORS proxy configured. Turn on Local network to connect directly, or add a proxy in AI provider settings.',
        );
        setTest({ kind: 'done' });
        return;
      }
      const proxyUrl = settings.data?.corsProxy?.url ?? null;
      const decryptedKey =
        hasProxy && sealedShared
          ? await openSecret(sealedShared, mk, 'cors-proxy/shared-key')
          : null;
      const corsProxy =
        hasProxy && proxyUrl && decryptedKey ? { url: proxyUrl, key: decryptedKey } : null;

      const plaintextKey =
        authScheme === 'none'
          ? null
          : keyInput
            ? keyInput
            : existing
              ? await openMcpKey(existing, mk)
              : null;
      const auth = buildAuth(plaintextKey);

      const result = await testMcpConnection({ url, hasProxy, allowDirect, corsProxy, auth });

      setRouting(result.routing);
      setResolvedEndpoint(result.resolvedEndpoint);
      setTools(result.tools);
      setLastError(result.error);
      setLastTestedAt(Date.now());
      setTest({ kind: 'done' });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
      setTest({ kind: 'done' });
    }
  }

  function onToggleAllowDirect() {
    setDirty(true);
    setAllowDirect((v) => !v);
    setRoutingChangedHint(routing !== null || resolvedEndpoint !== null);
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
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

      let auth: McpServerRow['auth'] = null;
      if (authScheme === 'bearer') {
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
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await upsert.mutateAsync(row);
      setDirty(false);
      back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageScaffold
      crumbs={[CRUMB_ROOT, { label: existing ? existing.name : 'Add MCP server' }]}
      back="/app/integrations"
      onHelp={onHelp}
      dirty={dirty}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
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
            onChange={(e) => {
              setUrl(e.target.value);
              setDirty(true);
              clearTestResult();
            }}
            autoComplete="off"
            className={inputClass}
          />
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

        {test.kind === 'done' && lastError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            ✗ {lastError}
          </div>
        ) : null}

        {test.kind === 'done' && !lastError && routing ? (
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
          <Button tone="destructive" className="self-start" onClick={() => setConfirmDelete(true)}>
            Remove server
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${existing?.name ?? ''}?`}
        body="The server and its stored key are deleted. Personas lose access to its tools."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (existing) {
            del.mutate(existing.id);
            back();
          }
        }}
      />
    </PageScaffold>
  );
}
