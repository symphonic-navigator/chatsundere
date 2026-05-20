// SPDX-License-Identifier: AGPL-3.0-only

import {
  type LinkedAccountRow,
  type PasskeyCredentialRow,
  deleteServerAccount,
  getLinkedAccount,
  listPasskeyCredentials,
} from '@chatsundere/crypto';
import {
  ConfirmTyped,
  InlineMarker,
  useConnectivityStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { copy } from '../../lib/copy.js';
import { httpServerClient } from '../../lib/server-client.js';

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'linked';
      linked: LinkedAccountRow;
      unsyncedPasskeys: PasskeyCredentialRow[];
    }
  | { kind: 'not_linked' }
  | { kind: 'error'; message: string };

/**
 * Server linking settings tab.
 *
 * Renders three states:
 * - Not linked: prompt to scan QR or paste an invitation URL (Task 10 routes).
 * - Linked + reachable: server info, disconnect, change-passphrase CTA.
 * - Linked + unreachable / auth-failed: banners with CTAs.
 *
 * The scan-QR and paste flows are registered in Task 10.
 */
export function ServerLinking() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);

  const connectivity = useConnectivityStore((s) => s.state);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = getDb();
        const [linked, creds] = await Promise.all([
          getLinkedAccount(db),
          listPasskeyCredentials(db),
        ]);
        if (cancelled) return;
        if (!linked) {
          setLoadState({ kind: 'not_linked' });
        } else {
          const unsyncedPasskeys = creds.filter((c) => !c.is_synced_with_server);
          setLoadState({ kind: 'linked', linked, unsyncedPasskeys });
        }
      } catch {
        if (!cancelled) setLoadState({ kind: 'error', message: 'Could not load server data.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDisconnect() {
    const session = useSessionStore.getState().session;
    if (!session?.accessToken) {
      // If we cannot reach the server we still delete the local linked_account row.
      // deleteServerAccount will call the server but we swallow the network error and
      // clear local state regardless.
    }
    setDisconnectBusy(true);
    try {
      await deleteServerAccount({
        db: getDb(),
        serverClient: httpServerClient,
        accessToken: session?.accessToken ?? '',
      });
      useConnectivityStore.getState().setState({ kind: 'local_online' });
      setDisconnectOpen(false);
      setLoadState({ kind: 'not_linked' });
    } catch {
      // Server call may fail when disconnected; local row is still removed above
      // in the crypto flow. Reflect the change anyway.
      setDisconnectOpen(false);
      setLoadState({ kind: 'not_linked' });
    } finally {
      setDisconnectBusy(false);
    }
  }

  const isOffline =
    connectivity.kind === 'server_unreachable' || connectivity.kind === 'server_auth_failed';

  if (loadState.kind === 'loading') {
    return <p className="text-paper-soft">Loading…</p>;
  }

  if (loadState.kind === 'error') {
    return <p className="text-sm text-danger">{loadState.message}</p>;
  }

  return (
    <section className="space-y-8">
      <h2 className="font-display text-2xl italic text-paper">
        {copy.settings.serverLinking.title}
      </h2>

      {/* ── Not linked ── */}
      {loadState.kind === 'not_linked' && (
        <div className="space-y-5">
          <p className="font-medium text-paper">{copy.settings.serverLinking.notLinkedTitle}</p>
          <p className="text-sm leading-relaxed text-paper-soft">
            {copy.settings.serverLinking.notLinkedBody}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/linking/scan"
              className="flex-1 rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              {copy.settings.serverLinking.scanCta}
            </Link>
            <Link
              to="/linking/paste"
              className="flex-1 rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-center text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80"
            >
              {copy.settings.serverLinking.pasteCta}
            </Link>
          </div>
        </div>
      )}

      {/* ── Linked ── */}
      {loadState.kind === 'linked' && (
        <div className="space-y-6">
          {/* Server info */}
          <dl className="space-y-3">
            <div className="flex justify-between gap-4">
              <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                {copy.settings.serverLinking.serverLabel}
              </dt>
              <dd className="truncate font-mono text-sm text-paper">{loadState.linked.base_url}</dd>
            </div>
            {loadState.linked.issuer_label && (
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                  {copy.settings.serverLinking.issuerLabel}
                </dt>
                <dd className="truncate text-sm text-paper">{loadState.linked.issuer_label}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                {copy.settings.serverLinking.roleLabel}
              </dt>
              <dd>
                <InlineMarker
                  tone={
                    loadState.linked.role === 'primary_admin'
                      ? 'warning'
                      : loadState.linked.role === 'admin'
                        ? 'default'
                        : 'default'
                  }
                >
                  {loadState.linked.role}
                </InlineMarker>
              </dd>
            </div>
          </dl>

          {/* Unsynced biometric banner */}
          {loadState.unsyncedPasskeys.length > 0 && (
            <div className="rounded-[var(--radius-card)] bg-warning/10 px-4 py-3 text-sm text-warning ring-1 ring-inset ring-warning/30">
              {copy.settings.serverLinking.syncBiometricBanner}
            </div>
          )}

          {/* Server unreachable banner */}
          {connectivity.kind === 'server_unreachable' && (
            <div className="rounded-[var(--radius-card)] bg-warning/10 px-4 py-3 text-sm text-warning ring-1 ring-inset ring-warning/30">
              {copy.settings.serverLinking.serverUnreachableBanner}
            </div>
          )}

          {/* Server auth-failed banner */}
          {connectivity.kind === 'server_auth_failed' && (
            <div className="space-y-3 rounded-[var(--radius-card)] bg-danger/10 px-4 py-3 ring-1 ring-inset ring-danger/30">
              <p className="text-sm text-danger">
                {copy.settings.serverLinking.serverAuthFailedBanner}
              </p>
              <Link
                to="/change-passphrase"
                className="inline-block text-xs text-paper underline-offset-2 hover:underline"
              >
                {copy.settings.serverLinking.syncPassphraseCta}
              </Link>
            </div>
          )}

          {/* Change passphrase CTA — greyed with tooltip when offline */}
          <div>
            {isOffline ? (
              <button
                type="button"
                disabled
                title={copy.settings.serverLinking.changePassphraseDisabledTooltip}
                className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copy.settings.serverLinking.changePassphraseCta}
              </button>
            ) : (
              <Link
                to="/change-passphrase"
                className="block w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-center text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80"
              >
                {copy.settings.serverLinking.changePassphraseCta}
              </Link>
            )}
          </div>

          {/* Disconnect */}
          <button
            type="button"
            onClick={() => setDisconnectOpen(true)}
            className="w-full rounded-[var(--radius-card)] bg-danger/10 px-4 py-3 text-sm font-medium text-danger ring-1 ring-inset ring-danger/30 transition-opacity hover:opacity-90"
          >
            {copy.settings.serverLinking.disconnectCta}
          </button>
        </div>
      )}

      {/* Disconnect confirm */}
      <ConfirmTyped
        open={disconnectOpen}
        title={copy.settings.serverLinking.confirmDisconnectTitle}
        body={copy.settings.serverLinking.confirmDisconnectBody}
        confirmToken={copy.settings.serverLinking.confirmDisconnectToken}
        confirmTokenLabel={`"${copy.settings.serverLinking.confirmDisconnectToken}"`}
        destructiveCta={copy.settings.serverLinking.disconnectCta}
        cancelCta="Cancel"
        busy={disconnectBusy}
        onCancel={() => setDisconnectOpen(false)}
        onConfirm={() => void handleDisconnect()}
      />
    </section>
  );
}
