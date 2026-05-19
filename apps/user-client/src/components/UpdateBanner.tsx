// SPDX-License-Identifier: AGPL-3.0-only
import { copy } from '../lib/copy.js';
import { useUpdateStore } from '../state/update.store.js';

/**
 * A slim top bar that appears when a new service-worker version is waiting.
 * Renders nothing until vite-plugin-pwa fires onNeedRefresh.
 */
export function UpdateBanner() {
  const needRefresh = useUpdateStore((s) => s.needRefresh);
  const doRefresh = useUpdateStore((s) => s.doRefresh);

  if (!needRefresh || !doRefresh) return null;

  return (
    <div className="bg-aurora-700/30 px-6 py-2 text-center font-mono text-xs text-paper">
      {copy.update.message}{' '}
      <button type="button" onClick={doRefresh} className="underline">
        {copy.update.refreshCta}
      </button>
    </div>
  );
}
