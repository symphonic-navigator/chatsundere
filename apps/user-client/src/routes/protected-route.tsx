// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { Navigate, Outlet } from 'react-router-dom';

/**
 * Layout-route guard for paths that require an active session.
 *
 * When the in-memory session is null, redirects to `/` so the `Gate`
 * component can decide where the user actually belongs (`/login` if a
 * local account exists, `/onboarding` otherwise).
 *
 * Why this exists: the in-memory session lives only in Zustand (no
 * persistence — `mk` must not survive a reload, see ADR 0005 and the
 * `closeAndForget` lifecycle). After any full-page reload (service-worker
 * update, browser back from external auth, manual refresh) the session
 * is gone, but the URL persists. Without this guard the user lands on
 * e.g. `/app` with a stripped Root header (no Settings, no username,
 * no Sign-out) — visibly broken.
 */
export function ProtectedRoute() {
  const session = useSessionStore((s) => s.session);
  if (!session) return <Navigate to="/" replace />;
  return <Outlet />;
}
