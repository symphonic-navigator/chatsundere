// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorScreen } from './components/ErrorScreen.js';
import { queryClient } from './lib/queryClient.js';
import { AppShell } from './routes/app-shell.js';
import { ChangePassphrase } from './routes/change-passphrase.js';
import { CreateAccount } from './routes/create-account/index.js';
import { Gate } from './routes/gate.js';
import { LinkingConfirm } from './routes/linking/confirm.js';
import { LinkingPaste } from './routes/linking/paste.js';
import { LinkingScan } from './routes/linking/scan.js';
import { Login } from './routes/login/index.js';
import { Recovery } from './routes/login/recovery.js';
import { Onboarding } from './routes/onboarding.js';
import { ProtectedRoute } from './routes/protected-route.js';
import { Root } from './routes/root.js';
import { About } from './routes/settings/about.js';
import { Account } from './routes/settings/account.js';
import { AuthMethods } from './routes/settings/auth-methods.js';
import { SettingsLayout } from './routes/settings/layout.js';
import { ServerLinking } from './routes/settings/server-linking.js';
import { useBootStore } from './state/boot.store.js';

function unreachable(phase: never): never {
  throw new Error(`Unhandled boot phase: ${JSON.stringify(phase)}`);
}

export function App() {
  const phase = useBootStore((s) => s.phase);

  switch (phase.kind) {
    case 'pending':
      return (
        <main className="grid min-h-dvh place-items-center px-6">
          <h1 className="font-display text-4xl italic tracking-tight text-aurora-200 lg:text-5xl">
            Chatsundere
          </h1>
        </main>
      );
    case 'runtime_failure':
      return (
        <ErrorScreen
          title="This browser can't run Chatsundere."
          body="Chatsundere needs the following web platform features. Please use a current browser."
          detail={phase.missing}
        />
      );
    case 'db_failure':
      return (
        <ErrorScreen
          title="Local storage is unavailable."
          body="Chatsundere can't access browser storage. Private windows, restrictive settings, or storage quota issues can cause this."
          detail={[phase.error]}
        />
      );
    case 'ready':
      return (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<Root />}>
                <Route index element={<Gate />} />
                {/* Routes that do NOT require a session. */}
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/create" element={<CreateAccount />} />
                <Route path="/login" element={<Login />} />
                <Route path="/login/recovery" element={<Recovery />} />
                {/* Routes that REQUIRE a session. Reload while in-memory
                    session is gone (e.g. after a service-worker refresh)
                    must not leave the user on a session-stripped Root layout
                    — ProtectedRoute reroutes through Gate. */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/app" element={<AppShell />} />
                  <Route path="/linking/scan" element={<LinkingScan />} />
                  <Route path="/linking/paste" element={<LinkingPaste />} />
                  <Route path="/linking/confirm" element={<LinkingConfirm />} />
                  <Route path="/change-passphrase" element={<ChangePassphrase />} />
                  <Route path="/settings" element={<SettingsLayout />}>
                    <Route index element={<Navigate to="account" replace />} />
                    <Route path="account" element={<Account />} />
                    <Route path="auth-methods" element={<AuthMethods />} />
                    <Route path="server-linking" element={<ServerLinking />} />
                    <Route path="about" element={<About />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      );
    default:
      return unreachable(phase);
  }
}
