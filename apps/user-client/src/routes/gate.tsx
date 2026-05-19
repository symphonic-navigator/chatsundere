// SPDX-License-Identifier: AGPL-3.0-only
import { getLocalAccount } from '@chatsundere/crypto';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../boot/open-db.js';
import { useBootStore } from '../state/boot.store.js';
import { useSessionStore } from '../state/session.store.js';

export function Gate() {
  const navigate = useNavigate();
  const phase = useBootStore((s) => s.phase);
  const session = useSessionStore((s) => s.session);

  useEffect(() => {
    if (phase.kind !== 'ready') return;
    if (session) {
      navigate('/app', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      const acc = await getLocalAccount(getDb());
      if (cancelled) return;
      navigate(acc ? '/login' : '/onboarding', { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [phase.kind, session, navigate]);

  return <p className="mt-12 text-center text-paper-soft">Loading…</p>;
}
