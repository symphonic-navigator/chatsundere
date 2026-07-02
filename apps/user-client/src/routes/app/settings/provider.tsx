// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  getProvider,
  getProxyAuthSource,
  probeProvider,
  providerServiceKinds,
} from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CapBadgeRow } from '../../../components/CapBadgeRow.js';
import {
  MODEL_DEBUG_TIMEOUT_MS,
  ModelDebugOverlay,
} from '../../../components/ModelDebugOverlay.js';
import { Badge } from '../../../components/ui/Badge.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../../../data/providers.js';
import { type DiagnosticReport, runStreamingTest } from '../../../lib/model-debug.js';
import { openSecret, sealSecret } from '../../../lib/secrets.js';
import { useServerGate } from '../../../lib/server-gate.js';

type Status =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok' }
  | { kind: 'error'; reason: string };

export function SettingsProviderPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-providers');
  const navigate = useNavigate();
  const { templateId = '' } = useParams();
  const definition = getProvider(templateId);

  const providers = useProviders();
  const proxyGate = useServerGate('proxy');
  const upsert = useUpsertProvider();
  const del = useDeleteProvider();
  const mk = useSessionStore((s) => s.mk);

  const existing = providers.data?.find((p) => p.templateId === templateId);
  const requiresProxy = definition?.corsHint === 'requires-proxy';

  // "Test a model" can only reach the transport when a key is saved and, for
  // proxy-required providers, the account relay is available. Otherwise a
  // precondition failure would masquerade as a model failure (spec §7).
  const hasSavedKey = existing != null;
  const proxyReady = !requiresProxy || proxyGate.enabled;
  const testDisabledReason = !hasSavedKey
    ? 'Save a key first'
    : !proxyReady
      ? (proxyGate.tooltip ?? 'Link a server first')
      : null;

  const [apiKey, setApiKey] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const back = () => navigate('/app/settings/providers');

  // ── Ported verbatim from ProviderSheet.tsx:46-133 ────────────────────────────
  //    Changes: (1) onClose() → back(); (2) needs-proxy reason text updated to
  //    reference "AI Providers" rather than "Upstream Providers".
  async function onSave() {
    if (!apiKey && !existing) {
      setStatus({ kind: 'error', reason: 'API key required' });
      return;
    }
    if (!mk || !definition) {
      setStatus({ kind: 'error', reason: 'No master key in session — re-login required' });
      return;
    }
    if (requiresProxy && !proxyGate.enabled) {
      setStatus({
        kind: 'error',
        reason: proxyGate.tooltip ?? 'Link a server to relay this provider',
      });
      return;
    }
    setSaving(true);
    setStatus({ kind: 'probing' });
    try {
      const rowId = existing?.id ?? 'pending';
      const apiKeySlotId = `provider/${rowId}/api-key`;
      const sealedKey = apiKey ? await sealSecret(apiKey, mk, apiKeySlotId) : existing?.apiKey;
      if (!sealedKey) {
        setSaving(false);
        return;
      }
      const row = await upsert.mutateAsync({
        id: existing?.id,
        templateId,
        apiKey: sealedKey,
        enabled: false,
      });

      const stableSlotId = `provider/${row.id}/api-key`;
      const stableSealedKey =
        apiKey && !existing ? await sealSecret(apiKey, mk, stableSlotId) : sealedKey;

      if (apiKey && !existing) {
        await upsert.mutateAsync({
          id: row.id,
          templateId,
          apiKey: stableSealedKey,
          enabled: false,
        });
      }

      // Proxy-required providers route through the account's authenticated
      // proxy, which is read late (at request-build time) from the registered
      // proxy auth source — nothing proxy-related is sealed or written here.
      const decryptedKey = await openSecret(stableSealedKey, mk, stableSlotId);

      const config = {
        baseUrl: definition.baseUrl,
        routing: requiresProxy ? ({ kind: 'cors-proxy' } as const) : ({ kind: 'direct' } as const),
      };
      const result = await probeProvider({
        definition,
        config,
        apiKey: decryptedKey,
      });

      if (result.ok) {
        await upsert.mutateAsync({
          id: row.id,
          templateId,
          apiKey: stableSealedKey,
          enabled: true,
        });
        setStatus({ kind: 'ok' });
        back();
      } else {
        setStatus({ kind: 'error', reason: `${result.status} · ${result.reason ?? ''}` });
      }
    } catch (e) {
      setStatus({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function runDebugTest(offering: Offering): Promise<DiagnosticReport> {
    if (!definition || !existing || !mk) {
      throw new Error('Model test: provider not fully configured');
    }
    if (requiresProxy && !proxyGate.enabled) {
      throw new Error(proxyGate.tooltip ?? 'Link a server to relay this provider');
    }
    const apiKeyPlain = await openSecret(existing.apiKey, mk, `provider/${existing.id}/api-key`);
    const proxyUrl = requiresProxy ? (getProxyAuthSource()?.getUrl() ?? null) : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_DEBUG_TIMEOUT_MS);
    try {
      return await runStreamingTest({
        provider: definition,
        providerConfig: {
          baseUrl: definition.baseUrl,
          routing: requiresProxy
            ? ({ kind: 'cors-proxy' } as const)
            : ({ kind: 'direct' } as const),
        },
        apiKey: apiKeyPlain,
        offering,
        proxyHost: proxyUrl ? new URL(proxyUrl).host : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  if (!definition) {
    return (
      <PageScaffold
        crumbs={[
          { label: 'My Settings', to: '/app/settings' },
          { label: 'AI Providers', to: '/app/settings/providers' },
          { label: 'Unknown' },
        ]}
        back="/app/settings/providers"
        onHelp={onHelp}
      >
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">
          This provider is no longer available — go back to AI Providers to pick another.
        </p>
      </PageScaffold>
    );
  }

  const displayName = definition.displayName ?? templateId;

  return (
    <PageScaffold
      crumbs={[
        { label: 'My Settings', to: '/app/settings' },
        { label: 'AI Providers', to: '/app/settings/providers' },
        { label: displayName },
      ]}
      back="/app/settings/providers"
      onHelp={onHelp}
      dirty={apiKey !== ''}
    >
      {helpOverlay}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
            {displayName.slice(0, 2)}
          </div>
          <div className="font-display text-sm text-paper">{displayName}</div>
        </div>

        <CapBadgeRow lit={providerServiceKinds(templateId)} />

        <div>
          <label
            htmlFor="ps-api-key"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            API key
          </label>
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
            <input
              id="ps-api-key"
              type={revealKey ? 'text' : 'password'}
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              name=""
              className="flex-1 bg-transparent font-mono text-sm text-paper outline-none"
            />
            <button
              type="button"
              onClick={() => setRevealKey((v) => !v)}
              aria-label={revealKey ? 'Hide key' : 'Show key'}
              className="text-paper-soft hover:text-paper"
            >
              ◉
            </button>
          </div>
        </div>

        {status.kind !== 'idle' ? (
          <div
            data-testid="sheet-status"
            className={`rounded-md border px-3 py-2 text-xs ${
              status.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : status.kind === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-paper-soft/30 bg-paper-soft/10 text-paper-soft'
            }`}
          >
            {status.kind === 'probing'
              ? 'Probing…'
              : status.kind === 'ok'
                ? '✓ Key valid · LLM unlocked'
                : `✗ ${(status as { kind: 'error'; reason: string }).reason}`}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Test & Save'}
          </button>
          {apiKey !== '' ? <Badge tone="warning">● Unsaved</Badge> : null}
        </div>

        <button
          type="button"
          onClick={() => setDebugOpen(true)}
          disabled={testDisabledReason != null}
          title={testDisabledReason ?? undefined}
          className="self-start rounded-md border border-paper-soft/30 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:bg-paper-soft/10 disabled:opacity-50"
        >
          Test a model
        </button>
        {testDisabledReason != null ? (
          <p className="text-xs text-paper-soft/70">{testDisabledReason}</p>
        ) : null}

        {existing ? (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="self-start rounded-md border px-3 py-1 text-xs uppercase tracking-wider"
            style={{
              borderColor: 'var(--color-destructive)',
              color: 'var(--color-destructive-text)',
            }}
          >
            Remove provider
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${displayName}?`}
        body="The key is deleted. Personas using this provider won't be able to connect."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          if (existing) void del.mutateAsync(existing.id).then(back);
        }}
      />
      {definition ? (
        <ModelDebugOverlay
          open={debugOpen}
          providerDisplayName={definition.displayName}
          offerings={definition.offerings}
          onClose={() => setDebugOpen(false)}
          runTest={runDebugTest}
        />
      ) : null}
    </PageScaffold>
  );
}
