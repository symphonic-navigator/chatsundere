// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, probeProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../data/providers.js';
import { useSettings } from '../data/settings.js';
import { openSecret, sealSecret } from '../lib/secrets.js';

interface Props {
  templateId:
    | 'chutes'
    | 'tensorix'
    | 'mistral'
    | 'wafer'
    | 'xai'
    | 'novita'
    | 'ollama-cloud'
    | 'nano-gpt'
    | 'openrouter';
  onClose: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok' }
  | { kind: 'error'; reason: string };

export function ProviderSheet({ templateId, onClose }: Props): JSX.Element {
  const definition = getProvider(templateId);
  const requiresProxy = definition?.corsHint === 'requires-proxy';
  const providers = useProviders();
  const settings = useSettings();
  const upsert = useUpsertProvider();
  const del = useDeleteProvider();
  const mk = useSessionStore((s) => s.mk);

  const existing = providers.data?.find((p) => p.templateId === templateId);

  const [apiKey, setApiKey] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!apiKey && !existing) {
      setStatus({ kind: 'error', reason: 'API key required' });
      return;
    }
    if (!mk || !definition) {
      setStatus({ kind: 'error', reason: 'No master key in session — re-login required' });
      return;
    }
    if (requiresProxy && !settings.data?.corsProxy) {
      setStatus({
        kind: 'error',
        reason: 'Set a CORS proxy first (My Settings → Upstream Providers)',
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

      // Proxy-required providers reuse the global CORS proxy configured in
      // My Settings → Upstream Providers. We only read it here for the probe;
      // it is never sealed or written from this sheet.
      const sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
      const decryptedProxyKey =
        requiresProxy && sealedShared
          ? await openSecret(sealedShared, mk, 'cors-proxy/shared-key')
          : null;
      const corsProxyUrl = requiresProxy ? (settings.data?.corsProxy?.url ?? null) : null;

      const decryptedKey = await openSecret(stableSealedKey, mk, stableSlotId);

      const config = {
        baseUrl: definition.baseUrl,
        routing: requiresProxy ? ({ kind: 'cors-proxy' } as const) : ({ kind: 'direct' } as const),
      };
      const result = await probeProvider({
        definition,
        config,
        apiKey: decryptedKey,
        corsProxyUrl,
        corsProxyKey: decryptedProxyKey,
      });

      if (result.ok) {
        await upsert.mutateAsync({
          id: row.id,
          templateId,
          apiKey: stableSealedKey,
          enabled: true,
        });
        setStatus({ kind: 'ok' });
        onClose();
      } else {
        setStatus({ kind: 'error', reason: `${result.status} · ${result.reason ?? ''}` });
      }
    } catch (e) {
      setStatus({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const displayName = definition?.displayName ?? templateId;

  return (
    <>
      <div
        data-ps-backdrop
        className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Dismiss sheet"
      />
      <div
        data-ps-sheet
        className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-white/10 bg-ink p-4 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
              {displayName.slice(0, 2)}
            </div>
            <div>
              <div className="font-display text-sm text-paper">{displayName}</div>
            </div>
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

        <div className="mb-3">
          <label
            htmlFor="ps-api-key"
            className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
          >
            API Key
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
            className={`mb-3 rounded-md border px-3 py-2 text-xs ${
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
            onClick={() => {
              void onSave();
            }}
            disabled={saving}
            className="flex-1 rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Test & Save'}
          </button>
        </div>

        {existing ? (
          <div className="mt-4 rounded-md border border-danger/30 p-3">
            <div className="text-xs font-medium uppercase tracking-widest text-danger">
              Remove this provider
            </div>
            <div className="mb-2 text-[11px] text-paper-soft">
              Key is deleted, personas using this provider won&apos;t be able to connect.
            </div>
            <button
              type="button"
              onClick={() => {
                void del.mutateAsync(existing.id).then(() => onClose());
              }}
              className="rounded-md border border-danger px-3 py-1 text-xs uppercase tracking-wider text-danger hover:bg-danger/10"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
