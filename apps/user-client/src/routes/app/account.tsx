// SPDX-License-Identifier: AGPL-3.0-only

import {
  CryptoError,
  changeUsername,
  getLocalAccount,
  listPasskeyCredentials,
} from '@chatsundere/crypto';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { Fingerprint, Info, KeyRound, Link2, Lock, LogOut, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { Badge } from '../../components/ui/Badge.js';
import { NavTile } from '../../components/ui/NavTile.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { copy } from '../../lib/copy.js';
import { APP_VERSION } from '../../lib/version.js';
import { InlineEditRow } from './account/InlineEditRow.js';

type AccountLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; username: string }
  | { kind: 'error'; message: string };

type BiometricLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number }
  | { kind: 'error' };

/**
 * My Account — the dashboard surface (spec §2.1).
 *
 * Inline-edit fields for username and display name (always-save model, spec
 * §2.3), read-only badges for biometrics / server / version, and the 2×3
 * navigation matrix for the account sub-tree.
 */
export function AccountPage(): JSX.Element {
  const navigate = useNavigate();
  const { onHelp, helpOverlay } = useHelp('my-account');

  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  // Session store gives us a reactive username after login; we also load from
  // IndexedDB (same pattern as account-section.tsx) to stay correct if the
  // session is closed/refreshed.
  const sessionUsername = useSessionStore((s) => s.session?.username ?? '');
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);

  const [accountState, setAccountState] = useState<AccountLoadState>({ kind: 'loading' });
  const [biometricState, setBiometricState] = useState<BiometricLoadState>({ kind: 'loading' });

  // Load the authoritative username + passkey count from IndexedDB on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await getLocalAccount(getDb());
        if (cancelled) return;
        if (!row) {
          navigate('/onboarding', { replace: true });
          return;
        }
        setAccountState({ kind: 'ready', username: row.username });
      } catch {
        if (!cancelled) setAccountState({ kind: 'error', message: 'Could not load account.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPasskeyCredentials(getDb());
        if (cancelled) return;
        setBiometricState({ kind: 'ready', count: rows.length });
      } catch {
        if (!cancelled) setBiometricState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer the IndexedDB-loaded username; fall back to session while loading.
  const username = accountState.kind === 'ready' ? accountState.username : (sessionUsername ?? '');

  const rawDisplayName = settings.data?.displayName ?? '';
  // Effective name: what others see — falls back to username when display name is empty.
  const effectiveName = rawDisplayName.trim() || username;

  async function handleSaveUsername(next: string): Promise<void> {
    try {
      await changeUsername({ db: getDb(), newUsername: next });
      setAccountState({ kind: 'ready', username: next });
    } catch (e) {
      if (e instanceof CryptoError && e.code === 'invalid_input') {
        throw new Error(copy.errors.usernameInvalid);
      }
      throw e;
    }
  }

  async function handleSaveDisplayName(next: string): Promise<void> {
    await updateSettings.mutateAsync({ displayName: next.trim() });
  }

  return (
    <PageScaffold crumbs={[{ label: 'My Account' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}

      {/* ── Dashboard ─────────────────────────────────────────────────────── */}
      <div className="space-y-6 px-4 pb-4 pt-2">
        {/* Effective name header — what others see */}
        <div className="space-y-0.5">
          <p className="font-display text-lg text-paper">{effectiveName}</p>
          <p className="text-xs text-paper-soft">How you appear to your companions</p>
        </div>

        {/* Inline edit fields */}
        <div className="space-y-4">
          <InlineEditRow
            label="Username"
            value={username}
            validate={(v) => {
              if (!v.trim()) return 'Username cannot be empty.';
              return null;
            }}
            onSave={handleSaveUsername}
          />

          <InlineEditRow
            label="Display name"
            value={rawDisplayName}
            placeholder={username}
            onSave={handleSaveDisplayName}
          />
        </div>

        {/* Read-only badges */}
        <div className="flex flex-wrap gap-2 text-xs text-paper-soft">
          {/* Biometrics */}
          {biometricState.kind === 'ready' ? (
            biometricState.count >= 1 ? (
              <Badge tone="success">Configured ({biometricState.count})</Badge>
            ) : (
              <Badge tone="neutral">Biometrics not set up</Badge>
            )
          ) : null}

          {/* Server link — dynamic, reflects the account-link store (spec: sync-lifecycle hardening) */}
          {linkStatus === 'linked' && (
            <Badge tone="success">{copy.serverLinking.linkedBadge}</Badge>
          )}
          {linkStatus === 'local-only' && (
            <Badge tone="neutral">{copy.serverLinking.localOnlyTitle}</Badge>
          )}
          {linkStatus === 'unknown' && <Badge tone="neutral">{copy.serverLinking.checking}</Badge>}

          {/* Version */}
          <span className="font-mono text-xs text-paper-soft">
            v{APP_VERSION.version} · sha {APP_VERSION.sha}
          </span>
        </div>
      </div>

      {/* ── 2×3 Navigation matrix ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-8">
        <NavTile
          colour="pink"
          icon={Fingerprint}
          label="Biometric"
          to="/app/account/biometric"
          meta="unlock on this device"
        />
        <NavTile
          colour="pink"
          icon={KeyRound}
          label="Recovery Key"
          to="/app/account/recovery"
          meta="your backup code"
        />
        <NavTile
          colour="pink"
          icon={Trash2}
          label="Recently deleted"
          to="/app/account/recently-deleted"
          meta="restore or purge · 30 days"
        />
        <NavTile
          colour="blue"
          icon={Link2}
          label="Server linking"
          to="/app/account/server-linking"
          meta="sync & unlink devices"
        />
        <NavTile
          colour="blue"
          icon={Info}
          label="About"
          to="/app/account/about"
          meta="version, licence, privacy"
        />
        <NavTile
          colour="purple"
          icon={Lock}
          label="Change passphrase"
          to="/change-passphrase"
          meta="set a new passphrase"
        />
        <NavTile
          colour="purple"
          icon={LogOut}
          label="Logout"
          to="/app/account/logout"
          meta="sign out · delete data"
        />
      </div>
    </PageScaffold>
  );
}
