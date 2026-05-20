// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

interface Props {
  children: ReactNode;
}

/**
 * Route guard for admin-client. Renders children only when there is a session
 * with `accessToken` and a role of `admin` or `primary_admin`. Otherwise
 * redirects to `/login` (which then runs its own decision tree per spec §6.2).
 */
export function AdminRouteGuard({ children }: Props) {
  const session = useSessionStore((s) => s.session);
  if (!session || !session.accessToken) {
    return <Navigate to="/login" replace />;
  }
  if (session.role !== 'admin' && session.role !== 'primary_admin') {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
