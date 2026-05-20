// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { Navigate } from 'react-router-dom';

/**
 * Root route gate. When entering `/` with an active admin session, jump to
 * `/dashboard`; otherwise hand off to `/login` (which then runs its own
 * decision tree per spec §6.2).
 */
export function Gate() {
  const session = useSessionStore((s) => s.session);
  if (session && (session.role === 'admin' || session.role === 'primary_admin')) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/login" replace />;
}
