// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSettings } from '../../../data/settings.js';

/** Notice shown on the Previews page when a project route is opened with the flag off. */
export const PROJECTS_PREVIEW_NOTICE = 'Projects is a preview — turn it on here.';

/**
 * Guards the project routes behind the Projects preview flag (spec §6.1).
 * Renders `children` (or the nested route) when on; redirects to Previews
 * with a notice when off. Renders nothing until settings have loaded so a
 * flag that is on never flashes the redirect.
 */
export function ProjectsGate({ children }: { children?: ReactNode }): JSX.Element | null {
  const settings = useSettings();
  if (settings.data === undefined) return null;
  if (settings.data.previews?.projects !== true) {
    return (
      <Navigate to="/app/settings/previews" replace state={{ notice: PROJECTS_PREVIEW_NOTICE }} />
    );
  }
  return children ? <>{children}</> : <Outlet />;
}
