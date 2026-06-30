// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorScreen } from './components/ErrorScreen.js';
import { MindspaceLayer } from './components/MindspaceLayer.js';
import { queryClient } from './lib/queryClient.js';
import { AccountPage } from './routes/app/account.js';
import { AboutPage } from './routes/app/account/about.js';
import { BiometricPage } from './routes/app/account/biometric.js';
import { DevToolsPage } from './routes/app/account/devtools.js';
import { LogoutPage } from './routes/app/account/logout.js';
import { RecoveryKeyPage } from './routes/app/account/recovery.js';
import { ServerLinkingPage } from './routes/app/account/server-linking.js';
import { ArtefactsPage } from './routes/app/chat/artefacts-page.js';
import { BookmarksPage } from './routes/app/chat/bookmarks-page.js';
import { ChatPage } from './routes/app/chat/chat-page.js';
import { KnowledgePage as ChatKnowledgePage } from './routes/app/chat/knowledge-page.js';
import { Circle } from './routes/app/circle.js';
import { EntranceHall } from './routes/app/entrance-hall.js';
import { HistoryPage } from './routes/app/history.js';
import { Integrations } from './routes/app/integrations.js';
import { IntegrationServerPage } from './routes/app/integrations/server.js';
import { KnowledgeList } from './routes/app/knowledge.js';
import { KnowledgeDocumentPage } from './routes/app/knowledge/document.js';
import { KnowledgeLibraryPage } from './routes/app/knowledge/library.js';
import { PersonaMemory } from './routes/app/persona-memory.js';
import { PersonaCreate } from './routes/app/persona/create.js';
import { PersonaFontVoice } from './routes/app/persona/font-voice.js';
import { PersonaHub } from './routes/app/persona/hub.js';
import { PersonaInstructions } from './routes/app/persona/instructions.js';
import { PersonaIntegrations } from './routes/app/persona/integrations.js';
import { PersonaKnowledge } from './routes/app/persona/knowledge.js';
import { PersonaMindspace } from './routes/app/persona/mindspace.js';
import { PersonaModelBehaviour } from './routes/app/persona/model-behaviour.js';
import { PersonaRoleplay } from './routes/app/persona/roleplay.js';
import { Settings as MySettings } from './routes/app/settings.js';
import { SettingsExpertPage } from './routes/app/settings/expert.js';
import { SettingsImagesPage } from './routes/app/settings/images.js';
import { SettingsProviderPage } from './routes/app/settings/provider.js';
import { SettingsProvidersPage } from './routes/app/settings/providers.js';
import { SettingsVoicePage } from './routes/app/settings/voice.js';
import { SettingsWebPage } from './routes/app/settings/web.js';
import { SettingsYouPage } from './routes/app/settings/you.js';
import { Treasury } from './routes/app/treasury.js';
import { TreasuryTemplatePage } from './routes/app/treasury/template.js';
import { TreasuryTemplatesList } from './routes/app/treasury/templates.js';
import { UiShowcase } from './routes/app/ui-showcase.js';
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
                {/* Internal dev showcase of UI primitives — no session required (presentational only) */}
                <Route path="/app/ui-showcase" element={<UiShowcase />} />
                {/* Session-required */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/app" element={<EntranceHall />} />
                  <Route path="/app/circle" element={<Circle />} />
                  <Route path="/app/persona/new" element={<PersonaCreate />} />
                  <Route path="/app/persona/:id" element={<PersonaHub />} />
                  <Route path="/app/persona/:id/font-voice" element={<PersonaFontVoice />} />
                  <Route path="/app/persona/:id/instructions" element={<PersonaInstructions />} />
                  <Route path="/app/persona/:id/integrations" element={<PersonaIntegrations />} />
                  <Route path="/app/persona/:id/knowledge" element={<PersonaKnowledge />} />
                  <Route path="/app/persona/:id/mindspace" element={<PersonaMindspace />} />
                  <Route path="/app/persona/:id/model" element={<PersonaModelBehaviour />} />
                  <Route path="/app/persona/:id/roleplay" element={<PersonaRoleplay />} />
                  <Route path="/app/persona/:id/memory" element={<PersonaMemory />} />
                  <Route path="/app/chat/new" element={<ChatPage />} />
                  <Route path="/app/chat/:chatId" element={<ChatPage />} />
                  <Route path="/app/chat/:chatId/bookmarks" element={<BookmarksPage />} />
                  <Route path="/app/chat/:chatId/artefacts" element={<ArtefactsPage />} />
                  <Route path="/app/chat/:chatId/knowledge" element={<ChatKnowledgePage />} />
                  <Route path="/app/history" element={<HistoryPage />} />
                  <Route path="/app/treasury" element={<Treasury />} />
                  <Route path="/app/treasury/templates" element={<TreasuryTemplatesList />} />
                  <Route path="/app/treasury/templates/new" element={<TreasuryTemplatePage />} />
                  <Route
                    path="/app/treasury/templates/:templateId"
                    element={<TreasuryTemplatePage />}
                  />
                  <Route path="/app/knowledge" element={<KnowledgeList />} />
                  <Route path="/app/knowledge/new" element={<KnowledgeLibraryPage />} />
                  <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
                  <Route path="/app/knowledge/:libraryId/new" element={<KnowledgeDocumentPage />} />
                  <Route
                    path="/app/knowledge/:libraryId/:documentId"
                    element={<KnowledgeDocumentPage />}
                  />
                  <Route path="/app/integrations" element={<Integrations />} />
                  <Route path="/app/integrations/new" element={<IntegrationServerPage />} />
                  <Route path="/app/integrations/:serverId" element={<IntegrationServerPage />} />
                  <Route path="/app/settings" element={<MySettings />} />
                  <Route path="/app/settings/you" element={<SettingsYouPage />} />
                  <Route path="/app/settings/providers" element={<SettingsProvidersPage />} />
                  <Route
                    path="/app/settings/providers/:templateId"
                    element={<SettingsProviderPage />}
                  />
                  <Route path="/app/settings/web" element={<SettingsWebPage />} />
                  <Route path="/app/settings/voice" element={<SettingsVoicePage />} />
                  <Route path="/app/settings/images" element={<SettingsImagesPage />} />
                  <Route path="/app/settings/expert" element={<SettingsExpertPage />} />
                  <Route path="/app/account" element={<AccountPage />} />
                  <Route path="/app/account/biometric" element={<BiometricPage />} />
                  <Route path="/app/account/recovery" element={<RecoveryKeyPage />} />
                  <Route path="/app/account/server-linking" element={<ServerLinkingPage />} />
                  <Route path="/app/account/about" element={<AboutPage />} />
                  {import.meta.env.DEV && (
                    <Route path="/app/account/about/devtools" element={<DevToolsPage />} />
                  )}
                  <Route path="/app/account/logout" element={<LogoutPage />} />
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
