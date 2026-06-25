// SPDX-License-Identifier: AGPL-3.0-only
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { VoiceSection } from '../../../components/voice/VoiceSection.js';
import { useHelp } from '../../../content/help/use-help.js';

export function SettingsVoicePage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-voice');
  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Voice' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="px-4 pb-8 pt-2">
        <VoiceSection />
      </div>
    </PageScaffold>
  );
}
