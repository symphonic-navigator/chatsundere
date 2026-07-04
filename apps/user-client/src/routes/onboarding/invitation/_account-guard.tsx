// SPDX-License-Identifier: AGPL-3.0-only
import { getLocalAccount } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getDb } from '../../../boot/open-db.js';

/**
 * The fresh-join guard's door (spec §4.1): on a device that already holds a
 * local account but has no unlocked session, the invitation flow must lead
 * through the local login (which preserves the MK and turns the join into a
 * late-link) instead of the join form (whose fresh path would mint a new MK —
 * the 2026-07-03 data-loss class). Wraps BOTH the input and confirm routes so
 * the QR deep-link path is covered too. An unlocked session passes through:
 * that IS the late-link.
 */
export function InvitationAccountGuard({ children }: { children: ReactNode }): JSX.Element | null {
  const mk = useSessionStore((s) => s.mk);
  const location = useLocation();
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await getLocalAccount(getDb());
        if (!cancelled) setHasAccount(row !== null && row !== undefined);
      } catch {
        // If the local account store cannot be read (e.g. the DB is not open
        // yet), do NOT block the flow: this guard is only the UX door, and the
        // crypto backstop (§4.2) is the hard wall that refuses a fresh-join over
        // an existing account regardless. Fail open to the children.
        if (!cancelled) setHasAccount(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (hasAccount === null) return null; // checking — a flash of the form would mislead
  if (!hasAccount || mk !== null) return <>{children}</>;

  const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <h1 className="mt-4 font-display text-2xl italic">This device already holds an account</h1>
      <p className="mt-2 text-sm text-paper-soft">
        Unlock it first, then connect it to the server — your chats and settings stay exactly as
        they are.
      </p>
      <Link
        to={`/login?return=${returnTo}`}
        className="mt-6 block w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-center text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        Unlock and connect →
      </Link>
    </main>
  );
}
