// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { uuidv7 } from 'uuidv7';
import type { McpServerRow } from '../../boot/client-data-db.js';
import {
  openMcpKey,
  sealMcpKey,
  useDeleteMcpServer,
  useUpsertMcpServer,
} from '../../data/mcp-servers.js';
import { useSettings } from '../../data/settings.js';
import { openSecret } from '../../lib/secrets.js';
import { testMcpConnection } from '../../mcp/mcp-connectivity.js';
import { sanitiseToolName } from '../../mcp/tool-naming.js';
import type { McpAuthResolved, McpToolDefinition } from '../../mcp/types.js';

interface Props {
  existing?: McpServerRow;
  onClose: () => void;
}

type AuthScheme = 'none' | 'bearer' | 'header';

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done' };

/** Bottom-sheet to add or edit a single MCP server: details, auth, connection test, tool selection. */
export function McpServerSheet({ existing, onClose }: Props): JSX.Element {
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

  // Test-result state, seeded from the existing row so re-opening shows prior results.
  const [routing, setRouting] = useState<McpServerRow['routing']>(existing?.routing ?? null);
  const [resolvedEndpoint, setResolvedEndpoint] = useState<string | null>(
    existing?.resolvedEndpoint ?? null,
  );
  const [tools, setTools] = useState<McpToolDefinition[]>(existing?.tools ?? []);
  const [hiddenTools, setHiddenTools] = useState<string[]>(existing?.hiddenTools ?? []);
  const [lastError, setLastError] = useState<string | null>(existing?.lastError ?? null);
  const [lastTestedAt, setLastTestedAt] = useState<number | null>(existing?.lastTestedAt ?? null);
  // True after a Local-network flip discarded a prior route — prompts a calm re-test cue.
  const [routingChangedHint, setRoutingChangedHint] = useState(false);

  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectivePrefix = prefixEdited ? prefix : sanitiseToolName(name);

  /**
   * Build the resolved auth header from the freshly-typed key, or null.
   * Returns null when the scheme is 'none', the key is empty, or the scheme is
   * 'header' but no header name has been provided — callers must treat null as
   * "no auth" (a scheme-switch without a new key intentionally clears auth).
   */
  function buildAuth(key: string | null): McpAuthResolved | null {
    if (!key) return null;
    if (authScheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
    if (authScheme === 'header' && headerName) return { header: headerName, value: key };
    return null;
  }

  /** Reset test-result state to untested; called when auth inputs change after a test. */
  function clearTestResult() {
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
    setLastTestedAt(null);
    setLastError(null);
    setTest({ kind: 'idle' });
  }

  async function onTest() {
    if (!mk || !url) {
      setError('A master key and a URL are required to test.');
      return;
    }
    setError(null);
    setRoutingChangedHint(false);
    setTest({ kind: 'testing' });
    try {
      const sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
      // hasProxy reflects whether the proxy is configured at all, not whether the
      // sealed key is present — matches the status logic in McpServersSection.
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

      // Prefer a freshly-typed key; otherwise reuse the existing sealed key.
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
    setAllowDirect((v) => !v);
    // The resolved route is no longer trustworthy once intent changes — force a re-test.
    // Surface a calm cue only when an actual prior route is being discarded.
    setRoutingChangedHint(routing !== null || resolvedEndpoint !== null);
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
    setLastError(null);
    setLastTestedAt(null);
    setTest({ kind: 'idle' });
  }

  function toggleHidden(toolName: string) {
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

      // Seal a freshly-typed key; otherwise preserve the existing sealed blob.
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
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';

  return (
    <>
      <div
        className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Dismiss sheet"
      />
      <div className="fixed inset-x-0 bottom-0 z-30 max-h-[90vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-ink p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="font-display text-sm text-paper">
            {existing ? 'Edit MCP server' : 'Add MCP server'}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1 text-paper-soft hover:text-paper"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3">
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
              onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setHeaderName(e.target.value)}
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
              onChange={onToggleAllowDirect}
              aria-label="Local network — connect directly (must support CORS)"
            />
            Local network <span className="text-paper-soft/60">(must support CORS)</span>
          </label>

          <button
            type="button"
            onClick={() => void onTest()}
            disabled={!mk || test.kind === 'testing'}
            title={!mk ? 'Unlock to test' : undefined}
            className="rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper disabled:opacity-50"
          >
            {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
          </button>

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
                        <span className="block text-[11px] text-paper-soft">
                          {tool.description}
                        </span>
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

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!mk || saving}
              title={!mk ? 'Unlock to save' : undefined}
              className="flex-1 rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {existing ? (
          <div className="mt-4 rounded-md border border-danger/30 p-3">
            <div className="text-xs font-medium uppercase tracking-widest text-danger">
              Remove this server
            </div>
            <div className="mb-2 text-[11px] text-paper-soft">
              The server and its stored key are deleted. Personas lose access to its tools.
            </div>
            {confirmDelete ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md border border-paper-soft/30 px-3 py-1 text-xs uppercase tracking-wider text-paper-soft"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    del.mutate(existing.id);
                    onClose();
                  }}
                  className="rounded-md border border-danger px-3 py-1 text-xs uppercase tracking-wider text-danger hover:bg-danger/10"
                >
                  Confirm remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-md border border-danger px-3 py-1 text-xs uppercase tracking-wider text-danger hover:bg-danger/10"
              >
                Remove
              </button>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
