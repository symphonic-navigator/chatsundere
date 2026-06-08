// SPDX-License-Identifier: AGPL-3.0-only

import type { FreedomState } from '@chatsundere/llm-unified';

/** TEE / ZDR trust pills, in the shared aurora/success palette. */
export function TrustBadge({ kind }: { kind: 'tee' | 'zdr' }): JSX.Element {
  const cfg =
    kind === 'tee'
      ? {
          label: 'TEE',
          title: 'Trusted Execution Environment — the host cannot read your data',
          cls: 'bg-success/15 text-success border-success/40',
        }
      : {
          label: 'ZDR',
          title: 'Zero Data Retention — the provider stores nothing after the request',
          cls: 'bg-aurora-500/20 text-aurora-200 border-aurora-500/50',
        };
  return (
    <span
      title={cfg.title}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

/**
 * The loud, honest signal for a censored model. Only 'restricted' carries a
 * badge today (free/unknown stay unmarked); restricted means the model — or its
 * deployment — applies content restrictions somewhere in the stack.
 */
export function FreedomBadge({ state }: { state: FreedomState }): JSX.Element | null {
  if (state !== 'restricted') return null;
  return (
    <span
      title="This model is censored by its maker. Reached via an anonymising router — the server never sees your data — but the model itself applies content restrictions."
      className="rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-danger"
    >
      Censored
    </span>
  );
}

/** Jurisdiction badge — the legal home of the deployment (e.g. EU). */
export function JurisdictionBadge({ code }: { code: string }): JSX.Element {
  return (
    <span
      title={`Jurisdiction: ${code}`}
      className="rounded border border-aurora-500/40 bg-aurora-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-aurora-200"
    >
      {code}
    </span>
  );
}
