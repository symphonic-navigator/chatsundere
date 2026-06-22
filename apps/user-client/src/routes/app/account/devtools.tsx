// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { getClientDataDb } from '../../../boot/client-data-db.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { toastStore } from '../../../state/toast.store.js';

/**
 * Developer tools page — only reachable when `import.meta.env.DEV` is true.
 * The About page's tile is gated by the same flag, so production builds
 * never render a route to here.
 *
 * Hosts the IndexedDB → /dumps dump action.
 */
export function DevToolsPage(): JSX.Element {
  const [busy, setBusy] = useState(false);

  const dump = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const db = getClientDataDb();
      const payload = {
        capturedAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        href: typeof location !== 'undefined' ? location.href : null,
        tables: {
          settings: await db.settings.toArray(),
          personas: await db.personas.toArray(),
          providers: await db.providers.toArray(),
          mindspaces: await db.mindspaces.toArray(),
          chats: await db.chats.toArray(),
          messages: await db.messages.toArray(),
          pills: await db.pills.toArray(),
        },
      };
      const res = await fetch('/__dump-db', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload, null, 2),
      });
      const data = (await res.json()) as { ok: boolean; file?: string; error?: string };
      toastStore.show({
        message: data.ok
          ? `DB dumped to ${data.file}`
          : `Dump failed: ${data.error ?? 'unknown error'}`,
        tone: data.ok ? 'success' : 'warn',
        durationMs: 5000,
      });
    } catch (e) {
      toastStore.show({
        message: `Dump failed: ${e instanceof Error ? e.message : String(e)}`,
        tone: 'warn',
        durationMs: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageScaffold
      back="/app/account/about"
      crumbs={[
        { label: 'My Account', to: '/app/account' },
        { label: 'About', to: '/app/account/about' },
        { label: 'Developer tools' },
      ]}
    >
      <div className="space-y-3">
        <p className="text-xs text-paper-soft">
          Visible in development builds only. These actions write to disk under{' '}
          <code className="font-mono text-paper">/dumps</code> and are intended for debugging.
        </p>
        <button
          type="button"
          onClick={() => void dump()}
          disabled={busy}
          className="rounded-md border border-paper-soft/30 bg-white/[0.02] px-3 py-2 text-xs uppercase tracking-wider text-paper hover:border-paper hover:bg-white/[0.05] disabled:opacity-40"
        >
          {busy ? 'Dumping…' : 'Dump IndexedDB → /dumps'}
        </button>
      </div>
    </PageScaffold>
  );
}
