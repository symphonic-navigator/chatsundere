// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorScreen } from './components/ErrorScreen.js';
import { MindspaceLayer } from './components/MindspaceLayer.js';
import { queryClient } from './lib/queryClient.js';
import { AccountPage } from './routes/app/account.js';
import { ChatPage } from './routes/app/chat/chat-page.js';
import { Circle } from './routes/app/circle.js';
import { EntranceHall } from './routes/app/entrance-hall.js';
import { HistoryPage } from './routes/app/history.js';
import { KnowledgeLibrary } from './routes/app/knowledge-library.js';
import { KnowledgeList } from './routes/app/knowledge.js';
import { PersonaEditor } from './routes/app/persona-editor.js';
import { Settings as MySettings } from './routes/app/settings.js';
import { Treasury } from './routes/app/treasury.js';
import { ChangePassphrase } from './routes/change-passphrase.js';
import { Gate } from './routes/gate.js';
import { Login } from './routes/login/index.js';
import { Recovery } from './routes/login/recovery.js';
import { InvitationConfirm } from './routes/onboarding/invitation/confirm.js';
import { InvitationForm } from './routes/onboarding/invitation/form.js';
import { InvitationRecoveryReveal } from './routes/onboarding/invitation/recovery-reveal.js';
import { InvitationScan } from './routes/onboarding/invitation/scan.js';
import { CreateAccount as LocalCreateAccount } from './routes/onboarding/local/index.js';
import { OnboardingMatrix } from './routes/onboarding/matrix.js';
import { PairingConfirm } from './routes/onboarding/pairing/confirm.js';
import { PairingForm } from './routes/onboarding/pairing/form.js';
import { PairingScan } from './routes/onboarding/pairing/scan.js';
import { OnboardingRecovery } from './routes/onboarding/recovery.js';
import { ProtectedRoute } from './routes/protected-route.js';
import { Root } from './routes/root.js';
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
          <MindspaceLayer />
          <BrowserRouter>
            <Routes>
              <Route element={<Root />}>
                <Route index element={<Gate />} />
                {/* No-session routes */}
                <Route path="/onboarding" element={<OnboardingMatrix />} />
                <Route path="/onboarding/invitation" element={<InvitationForm />} />
                <Route path="/onboarding/invitation/scan" element={<InvitationScan />} />
                <Route path="/onboarding/invitation/confirm" element={<InvitationConfirm />} />
                <Route
                  path="/onboarding/invitation/recovery"
                  element={<InvitationRecoveryReveal />}
                />
                <Route path="/onboarding/pairing" element={<PairingForm />} />
                <Route path="/onboarding/pairing/scan" element={<PairingScan />} />
                <Route path="/onboarding/pairing/confirm" element={<PairingConfirm />} />
                <Route path="/onboarding/recovery" element={<OnboardingRecovery />} />
                <Route path="/onboarding/local" element={<LocalCreateAccount />} />
                <Route path="/login" element={<Login />} />
                <Route path="/login/recovery" element={<Recovery />} />
                {/* Session-required */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/app" element={<EntranceHall />} />
                  <Route path="/app/circle" element={<Circle />} />
                  <Route path="/app/persona/new" element={<PersonaEditor />} />
                  <Route path="/app/persona/:id" element={<PersonaEditor />} />
                  <Route path="/app/chat/new" element={<ChatPage />} />
                  <Route path="/app/chat/:chatId" element={<ChatPage />} />
                  <Route path="/app/history" element={<HistoryPage />} />
                  <Route path="/app/treasury" element={<Treasury />} />
                  <Route path="/app/knowledge" element={<KnowledgeList />} />
                  <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibrary />} />
                  <Route path="/app/settings" element={<MySettings />} />
                  <Route path="/app/account" element={<AccountPage />} />
                  <Route path="/change-passphrase" element={<ChangePassphrase />} />
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
