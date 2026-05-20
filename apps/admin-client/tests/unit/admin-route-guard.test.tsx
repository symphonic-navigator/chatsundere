// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminRouteGuard } from '../../src/lib/admin-route-guard.js';

function Probe() {
  return <div>protected-content</div>;
}

function Login() {
  return <div>login-screen</div>;
}

function renderAt(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <AdminRouteGuard>
              <Probe />
            </AdminRouteGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRouteGuard', () => {
  beforeEach(() => {
    useSessionStore.setState({ session: null } as never);
  });

  it('redirects to /login when no session', () => {
    renderAt(['/dashboard']);
    expect(screen.getByText('login-screen')).toBeInTheDocument();
  });

  it('redirects to /login when role is user', () => {
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'tok', role: 'user', mk: null },
    } as never);
    renderAt(['/dashboard']);
    expect(screen.getByText('login-screen')).toBeInTheDocument();
  });

  it('renders children when role is admin', () => {
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'tok', role: 'admin', mk: null },
    } as never);
    renderAt(['/dashboard']);
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });

  it('renders children when role is primary_admin', () => {
    useSessionStore.setState({
      session: { userId: 'u-1', accessToken: 'tok', role: 'primary_admin', mk: null },
    } as never);
    renderAt(['/dashboard']);
    expect(screen.getByText('protected-content')).toBeInTheDocument();
  });
});
