// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useProviders } from '../data/providers.js';
import { useSettings, useUpdateSettings } from '../data/settings.js';
import { sealSecret } from '../lib/secrets.js';

/**
 * Global CORS-proxy configuration. Transitional alpha scaffolding — at beta the
 * authenticated proxy moves server-side and this block is removed. It gives the
 * single global proxy (today only set as a side-effect inside ProviderSheet) a
 * real home at the top of the Upstream-Providers section.
 */
export function CorsProxyBlock(): JSX.Element {
  const settings = useSettings();
  const providers = useProviders();
  const update = useUpdateSettings();
  const mk = useSessionStore((s) => s.mk);

  const current = settings.data?.corsProxy ?? null;
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(current?.url ?? '');
  const [shared, setShared] = useState('');

  async function onSave() {
    if (!mk || !url) return;
    // Seal a freshly-typed shared key; otherwise keep the existing sealed blob.
    const sharedKey = shared
      ? await sealSecret(shared, mk, 'cors-proxy/shared-key')
      : current?.sharedKey;
    if (!sharedKey) return;
    await update.mutateAsync({ corsProxy: { url, sharedKey } });
    setShared('');
    setEditing(false);
  }

  function onClear() {
    const active = (providers.data ?? [])
      .filter((p) => p.enabled && getProvider(p.templateId)?.corsHint === 'requires-proxy')
      .map((p) => getProvider(p.templateId)?.displayName ?? p.templateId);
    if (active.length > 0) {
      const ok = window.confirm(
        `${active.join(', ')} need this proxy and will become unavailable until you set one again. Remove the proxy?`,
      );
      if (!ok) return;
    }
    void update.mutateAsync({ corsProxy: null });
    setUrl('');
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-paper-soft">
          CORS Proxy · advanced
        </span>
        {current ? (
          <span className="text-[10px] text-success">● Set</span>
        ) : (
          <span className="text-[10px] text-paper-soft">No proxy set</span>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            aria-label="Proxy URL"
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            name=""
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
          />
          <input
            aria-label="Shared key"
            type="password"
            placeholder={current ? 'leave blank to keep current' : 'shared secret'}
            value={shared}
            onChange={(e) => setShared(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            name=""
            className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-md border border-paper-soft/30 px-3 py-1.5 text-xs uppercase tracking-wider text-paper-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              className="flex-1 rounded-md bg-paper px-3 py-1.5 text-xs uppercase tracking-wider text-ink"
            >
              Save proxy
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-paper-soft">
            {current?.url ?? '—'}
          </span>
          <button
            type="button"
            onClick={() => {
              setUrl(current?.url ?? '');
              setEditing(true);
            }}
            className="rounded-md border border-paper-soft/30 px-2 py-1 text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper"
          >
            {current ? 'Edit' : 'Set'}
          </button>
          {current ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-danger/40 px-2 py-1 text-[11px] uppercase tracking-wider text-danger hover:bg-danger/10"
            >
              Clear
            </button>
          ) : null}
        </div>
      )}

      <p className="mt-2 text-[11px] text-paper-soft/70">
        Temporary — replaced by your server connection at beta.
      </p>
    </div>
  );
}
