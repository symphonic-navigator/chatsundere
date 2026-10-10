// SPDX-License-Identifier: AGPL-3.0-only
import { aggregateServiceKinds } from '@chatsundere/llm-unified';
import {
  AudioLines,
  Boxes,
  FlaskConical,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Sparkles,
  User,
} from 'lucide-react';
import { NavTile } from '../../components/ui/NavTile.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useProviders } from '../../data/providers.js';
import { usePreviewFlag } from '../../data/settings.js';
import { useServerGate } from '../../lib/server-gate.js';
import { usableTemplateIds } from '../../lib/usable-providers.js';
import { useProjects } from '../../projects/hooks.js';

/** The Projects preview tile; mounted only while the preview is on, so the flag-off page never reads projects. */
function ProjectsTile(): JSX.Element {
  const count = useProjects()?.length;
  return (
    <NavTile
      colour="green"
      icon={FolderOpen}
      label="Projects (preview)"
      to="/app/projects"
      meta={
        count === undefined
          ? undefined
          : `${count} ${count === 1 ? 'project' : 'projects'} · this device`
      }
    />
  );
}

/** My Settings — the root navigation matrix (spec §2). */
export function Settings(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings');
  const providers = useProviders();
  const hasProxy = useServerGate('proxy').enabled;
  const projectsOn = usePreviewFlag('projects');

  const rows = providers.data ?? [];
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
        <NavTile
          colour="green"
          icon={FlaskConical}
          label="Previews"
          to="/app/settings/previews"
          meta="try early features"
        />
        {projectsOn ? <ProjectsTile /> : null}
      </div>
    </PageScaffold>
  );
}
