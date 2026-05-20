// SPDX-License-Identifier: AGPL-3.0-only
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AdminRouteGuard } from './lib/admin-route-guard.js';
import { AuditScreen } from './routes/audit/index.js';
import { DashboardScreen } from './routes/dashboard/index.js';
import { Gate } from './routes/gate.js';
import { InvitationsScreen } from './routes/invitations/index.js';
import { LoginScreen } from './routes/login/index.js';
import { RootLayout } from './routes/root.js';
import { UserDetailScreen } from './routes/users/detail.js';
import { UsersListScreen } from './routes/users/index.js';

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/" element={<Gate />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route
          element={
            <AdminRouteGuard>
              <RootLayout />
            </AdminRouteGuard>
          }
        >
          <Route path="/dashboard" element={<DashboardScreen />} />
          <Route path="/users" element={<UsersListScreen />} />
          <Route path="/users/:id" element={<UserDetailScreen />} />
          <Route path="/invitations" element={<InvitationsScreen />} />
          <Route path="/audit" element={<AuditScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
