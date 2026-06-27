// SPDX-License-Identifier: AGPL-3.0-only

import { getProvider } from '@chatsundere/llm-unified';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useProviders } from '../data/providers.js';
import { useSettings, useUpdateSettings } from '../data/settings.js';
import { CORS_PROXY_URL } from '../lib/cors-proxy.js';
import { sealSecret } from '../lib/secrets.js';

/**
 * Global CORS-proxy configuration. Transitional alpha scaffolding — at beta the
 * authenticated proxy moves server-side and this block is removed. The proxy
 * endpoint is fixed ({@link CORS_PROXY_URL}); the user supplies only the access
 * key, which is sealed to the master key before it is stored.
 */
export function CorsProxyBlock(): JSX.Element {
  const settings = useSettings();
  const providers = useProviders();
  const update = useUpdateSettings();
  const mk = useSessionStore((s) => s.mk);

  const current = settings.data?.corsProxy ?? null;
  const [editing, setEditing] = useState(false);
  const [shared, setShared] = useState('');

  async function onSave() {
    // A freshly-typed key is required the first time; when editing an existing
    // proxy a blank field keeps the current sealed key.
    if (!mk) return;
    const sharedKey = shared
      ? await sealSecret(shared, mk, 'cors-proxy/shared-key')
      : current?.sharedKey;
    if (!sharedKey) return;
    await update.mutateAsync({ corsProxy: { url: CORS_PROXY_URL, sharedKey } });
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
    setShared('');
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-paper-soft">
          CORS Proxy · advanced
        </span>
        {current ? (
          <span className="text-[10px] text-success">● Key set</span>
        ) : (
          <span className="text-[10px] text-paper-soft">No key set</span>
        )}
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-paper-soft/80">
          {CORS_PROXY_URL}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            aria-label="Access key"
            type="password"
            placeholder={current ? 'leave blank to keep current key' : 'access key'}
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
              onClick={() => {
                setShared('');
                setEditing(false);
              }}
              className="flex-1 rounded-md border border-paper-soft/30 px-3 py-1.5 text-xs uppercase tracking-wider text-paper-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              className="flex-1 rounded-md bg-paper px-3 py-1.5 text-xs uppercase tracking-wider text-ink"
            >
              Save key
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-paper-soft/30 px-2 py-1 text-[11px] uppercase tracking-wider text-paper-soft hover:text-paper"
          >
            {current ? 'Change key' : 'Set key'}
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
