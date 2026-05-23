// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider, probeProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useDeleteProvider, useProviders, useUpsertProvider } from '../data/providers.js';
import { useSettings, useUpdateSettings } from '../data/settings.js';
import { openSecret, sealSecret } from '../lib/secrets.js';

interface Props {
  templateId: 'nano-gpt' | 'novita' | 'ollama-cloud';
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
  const updateSettings = useUpdateSettings();
  const mk = useSessionStore((s) => s.mk);

  const existing = providers.data?.find((p) => p.templateId === templateId);

  const [apiKey, setApiKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState(settings.data?.corsProxy?.url ?? '');
  const [proxyShared, setProxyShared] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function close() {
    if (!apiKey && !existing) {
      onClose();
      return;
    }
    if (!mk || !definition) {
      setStatus({ kind: 'error', reason: 'No master key in session — re-login required' });
      onClose();
      return;
    }
    setStatus({ kind: 'probing' });
    try {
      const rowId = existing?.id ?? 'pending';
      const apiKeySlotId = `provider/${rowId}/api-key`;
      const sealedKey = apiKey ? await sealSecret(apiKey, mk, apiKeySlotId) : existing?.apiKey;
      if (!sealedKey) {
        onClose();
        return;
      }
      const row = await upsert.mutateAsync({
        id: existing?.id,
        templateId,
        apiKey: sealedKey,
        enabled: false,
      });

      // Re-seal with the stable row id as slotId when we just created the row.
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

      if (requiresProxy && proxyUrl && proxyShared) {
        const sealedShared = await sealSecret(proxyShared, mk, 'cors-proxy/shared-key');
        await updateSettings.mutateAsync({
          corsProxy: { url: proxyUrl, sharedKey: sealedShared },
        });
      }

      // Probe with decrypted values.
      const decryptedKey = await openSecret(stableSealedKey, mk, stableSlotId);
      const decryptedProxyKey =
        requiresProxy && settings.data?.corsProxy
          ? await openSecret(settings.data.corsProxy.sharedKey, mk, 'cors-proxy/shared-key')
          : null;

      const config = {
        baseUrl: definition.baseUrl,
        routing: requiresProxy ? ({ kind: 'cors-proxy' } as const) : ({ kind: 'direct' } as const),
      };
      const result = await probeProvider({
        definition,
        config,
        apiKey: decryptedKey,
        corsProxyUrl: requiresProxy ? proxyUrl || settings.data?.corsProxy?.url || null : null,
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
      } else {
        setStatus({ kind: 'error', reason: `${result.status} · ${result.reason ?? ''}` });
      }
    } catch (e) {
      setStatus({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    } finally {
      onClose();
    }
  }

  const displayName = definition?.displayName ?? templateId;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-white/10 bg-bg p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
            {displayName.slice(0, 2)}
          </div>
          <div>
            <div className="font-display text-sm text-paper">{displayName}</div>
            <div className="text-xs text-paper-soft">Text capability</div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            void close();
          }}
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
            className="flex-1 bg-transparent font-mono text-sm text-paper outline-none"
          />
          <button
            type="button"
            onClick={() => setRevealKey((v) => !v)}
            className="text-paper-soft hover:text-paper"
          >
            ◉
          </button>
        </div>
        <p className="mt-1 text-[11px] text-paper-soft">
          Key is tested automatically when you close this sheet.
        </p>
      </div>

      {requiresProxy ? (
        <div className="mb-3 space-y-2 border-t border-white/5 pt-3">
          <div>
            <label
              htmlFor="ps-proxy-url"
              className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
            >
              Proxy URL
            </label>
            <input
              id="ps-proxy-url"
              type="text"
              placeholder="proxy url (https://cors-proxy.tidesson.net)"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="ps-proxy-shared"
              className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
            >
              Shared key
            </label>
            <input
              id="ps-proxy-shared"
              type="password"
              placeholder="shared secret"
              value={proxyShared}
              onChange={(e) => setProxyShared(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
            />
          </div>
          <p className="text-[11px] text-paper-soft">
            Required for Ollama Cloud. Stored once and reused for any provider that needs a proxy.
          </p>
        </div>
      ) : null}

      {status.kind !== 'idle' ? (
        <div
          data-testid="sheet-status"
          className={`mb-3 rounded-md border px-3 py-2 text-xs ${
            status.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : status.kind === 'error'
                ? 'border-coral/30 bg-coral/10 text-coral'
                : 'border-paper-soft/30 bg-paper-soft/10 text-paper-soft'
          }`}
        >
          {status.kind === 'probing'
            ? 'Probing…'
            : status.kind === 'ok'
              ? '✓ Key valid'
              : `✗ ${(status as { kind: 'error'; reason: string }).reason}`}
        </div>
      ) : null}

      {existing ? (
        <div className="mt-2 rounded-md border border-coral/30 p-3">
          <div className="text-xs font-medium uppercase tracking-widest text-coral">
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
            className="rounded-md border border-coral px-3 py-1 text-xs uppercase tracking-wider text-coral hover:bg-coral/10"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
