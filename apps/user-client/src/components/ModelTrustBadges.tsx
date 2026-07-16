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
 * Honest signal on the freedom/censorship axis. 'restricted' → a loud red
 * "Censored" (the model or its deployment applies content restrictions).
 * 'unknown' → a muted "Uncensored?" — we have not yet evaluated whether this
 * model censors, and absence of a badge would otherwise read as a positive
 * all-clear. 'free' stays unmarked (the common, cleared norm). The axis lives in
 * the visible label, not just the tooltip, because the mobile-first surface has
 * no hover (spec 2026-07-16, Laura spec-pass).
 */
export function FreedomBadge({ state }: { state: FreedomState }): JSX.Element | null {
  if (state === 'restricted') {
    return (
      <span
        title="This model is censored by its maker. Reached via an anonymising router — the server never sees your data — but the model itself applies content restrictions."
        className="rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-danger"
      >
        Censored
      </span>
    );
  }
  if (state === 'unknown') {
    return (
      <span
        title="Not yet evaluated for content restrictions — an independent safety evaluation is pending."
        className="rounded border border-paper-soft/30 bg-paper-soft/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-paper-soft"
      >
        Uncensored?
      </span>
    );
  }
  return null;
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
