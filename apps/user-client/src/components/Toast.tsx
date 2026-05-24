// SPDX-License-Identifier: AGPL-3.0-only
import { useToastStore } from '../state/toast.store.js';

/** Renders the global toast queue. Mount once at the layout root. */
export function Toast(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <output className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone}>
          {t.message}
        </div>
      ))}
    </output>
  );
}
