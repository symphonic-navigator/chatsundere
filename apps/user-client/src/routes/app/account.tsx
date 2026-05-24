// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { useSettings, useUpdateSettings } from '../../data/settings.js';
import { AboutSection } from './account-sections/about-section.js';
import { AccountSection } from './account-sections/account-section.js';
import { AuthMethodsSection } from './account-sections/auth-methods-section.js';
import { ServerLinkingSection } from './account-sections/server-linking-section.js';

/**
 * My Account — the identity / auth / server-linking surface.
 *
 * Display Name is a draft field that persists on Save & Back, matching
 * the Save & Back pattern used by Persona Editor and My Settings.
 * Username / passkeys / recovery keep their own transactional flows
 * (each section persists its own atomic actions independently).
 */
export function AccountPage(): JSX.Element {
  const navigate = useNavigate();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const [draftDisplayName, setDraftDisplayName] = useState('');
  const [displayNameLoaded, setDisplayNameLoaded] = useState(false);

  useEffect(() => {
    if (!displayNameLoaded && settings.data) {
      setDraftDisplayName(settings.data.displayName ?? '');
      setDisplayNameLoaded(true);
    }
  }, [settings.data, displayNameLoaded]);

  const isDirty =
    displayNameLoaded && draftDisplayName.trim() !== (settings.data?.displayName ?? '');

  async function onSaveAndBack() {
    if (isDirty) {
      await updateSettings.mutateAsync({ displayName: draftDisplayName.trim() });
    }
    navigate('/app');
  }

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorSticky>
        <EditorTopbar
          title="My Account"
          isDirty={isDirty}
          onBack={() => navigate('/app')}
          onSaveAndBack={() => {
            void onSaveAndBack();
          }}
          saveDisabled={!isDirty}
        />
      </EditorSticky>

      <AccordionCard icon="◉" label="Account" meta="Display name · username · sign-out · delete">
        <AccountSection
          draftDisplayName={draftDisplayName}
          setDraftDisplayName={setDraftDisplayName}
          displayNameLoaded={displayNameLoaded}
        />
      </AccordionCard>

      <AccordionCard icon="⚿" label="Auth Methods" meta="Passphrase · biometrics · recovery key">
        <AuthMethodsSection />
      </AccordionCard>

      <AccordionCard icon="⇄" label="Server Linking" meta="Link this device to a server">
        <ServerLinkingSection serverUrl={null} />
      </AccordionCard>

      <AccordionCard icon="ⓘ" label="About" meta="Version · licence · docs">
        <AboutSection />
      </AccordionCard>
    </section>
  );
}
