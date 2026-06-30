// SPDX-License-Identifier: AGPL-3.0-only
import { aggregateServiceKinds } from '@chatsundere/llm-unified';
import { AudioLines, Boxes, Globe, Image as ImageIcon, Sparkles, User } from 'lucide-react';
import { NavTile } from '../../components/ui/NavTile.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useProviders } from '../../data/providers.js';
import { useSettings } from '../../data/settings.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';

/** My Settings — the root navigation matrix (spec §2). */
export function Settings(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings');
  const providers = useProviders();
  const settings = useSettings();

  const rows = providers.data ?? [];
  const hasProxy = !!settings.data?.corsProxy;
  const usable = usableTemplateIds(rows, hasProxy);
  const hasWeb = aggregateServiceKinds(usable).includes('web');
  const providerCount = rows.length;

  return (
    <PageScaffold crumbs={[{ label: 'My Settings' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="grid grid-cols-2 gap-3 px-4 pb-8 pt-2">
        <NavTile
          colour="pink"
          icon={User}
          label="You"
          to="/app/settings/you"
          meta="how the AI sees you"
        />
        <NavTile
          colour="pink"
          icon={Boxes}
          label="AI Providers"
          to="/app/settings/providers"
          meta={
            providerCount === 0
              ? 'none yet'
              : `${providerCount} provider${providerCount === 1 ? '' : 's'}`
          }
        />
        <NavTile
          colour="blue"
          icon={Globe}
          label="Web Access"
          to={hasWeb ? '/app/settings/web' : undefined}
          meta={hasWeb ? 'search & fetch the internet' : undefined}
          disabled={!hasWeb}
          disabledReason="Add a web-capable provider under AI Providers to enable."
        />
        <NavTile
          colour="blue"
          icon={AudioLines}
          label="Voice"
          to="/app/settings/voice"
          meta="read-aloud, dictation & FX"
        />
        <NavTile
          colour="purple"
          icon={ImageIcon}
          label="Images"
          to="/app/settings/images"
          meta="reading & creating images"
        />
        <NavTile
          colour="purple"
          icon={Sparkles}
          label={'"Ask an Expert"'}
          to="/app/settings/expert"
          meta="delegate hard questions"
        />
      </div>
    </PageScaffold>
  );
}
