// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { AccordionCard } from '../../components/AccordionCard.js';
import { EditorSticky } from '../../components/EditorSticky.js';
import { EditorTopbar } from '../../components/EditorTopbar.js';
import { AboutSection } from './account-sections/about-section.js';
import { AccountSection } from './account-sections/account-section.js';
import { AuthMethodsSection } from './account-sections/auth-methods-section.js';
import { ServerLinkingSection } from './account-sections/server-linking-section.js';

/**
 * My Account — the identity / auth / server-linking surface.
 *
 * Composes four sections into accordions: Account (username, sign-out,
 * destructive delete), Auth Methods (passkeys, recovery), Server Linking
 * (link-to-server hand-off), About (version, licence, docs). Each section
 * owns its own persistence (no global SaveBar); the topbar's Save & Back
 * is hidden because there is no global draft to persist.
 */
export function AccountPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <section className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <EditorSticky>
        <EditorTopbar
          title="My Account"
          isDirty={false}
          onBack={() => navigate('/app')}
          onSaveAndBack={() => {}}
          hideSaveAndBack
        />
      </EditorSticky>

      <AccordionCard icon="◉" label="Account" meta="Username · sign-out · delete">
        <AccountSection />
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
