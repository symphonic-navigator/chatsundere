// SPDX-License-Identifier: AGPL-3.0-only
import { useLocation } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { VoiceSection } from '../../../components/voice/VoiceSection.js';
import { useHelp } from '../../../content/help/use-help.js';

/**
 * The back target a sender passed as router state (`{ returnTo }`), e.g. the
 * persona Font & Voice page. Only an in-app path is honoured; anything else
 * falls back to My Settings.
 */
function returnTarget(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const returnTo = (state as { returnTo?: unknown }).returnTo;
  return typeof returnTo === 'string' && returnTo.startsWith('/app/') ? returnTo : null;
}

/** My Settings → Voice. Back returns to the sending page when one was passed. */
export function SettingsVoicePage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-voice');
  const location = useLocation();
  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Voice' }]}
      back={returnTarget(location.state) ?? '/app/settings'}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="px-4 pb-8 pt-2">
        <VoiceSection />
      </div>
    </PageScaffold>
  );
}
