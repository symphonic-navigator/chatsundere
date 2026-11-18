// SPDX-License-Identifier: AGPL-3.0-only
import { useSearchParams } from 'react-router-dom';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { VoiceSection } from '../../../components/voice/VoiceSection.js';
import { useHelp } from '../../../content/help/use-help.js';
import { safeReturnPath } from '../../../lib/safe-return.js';

/** My Settings → Voice. Back returns to the `?return=` sender, else My Settings. */
export function SettingsVoicePage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-voice');
  const [search] = useSearchParams();
  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Voice' }]}
      back={safeReturnPath(search.get('return'), '/app/settings')}
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="px-4 pb-8 pt-2">
        <VoiceSection />
      </div>
    </PageScaffold>
  );
}
