// SPDX-License-Identifier: AGPL-3.0-only
import { ExternalLink, Library, Scale, ShieldCheck, Wrench } from 'lucide-react';
import { useRef, useState } from 'react';
import { NavTile } from '../../../components/ui/NavTile.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { ReadingOverlay } from '../../../components/ui/ReadingOverlay.js';
import { renderThirdPartyMarkdown } from '../../../content/about/third-party.js';
import { AGPL_MD, PRIVACY_MD } from '../../../content/help/index.js';
import { useHelp } from '../../../content/help/use-help.js';
import { copy } from '../../../lib/copy.js';
import { APP_VERSION } from '../../../lib/version.js';

const l = copy.settings.about.licence;

export function AboutPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('about');
  const [reader, setReader] = useState<{ title: string; markdown: string } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const open = (el: HTMLElement, title: string, markdown: string): void => {
    triggerRef.current = el;
    setReader({ title, markdown });
  };

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'About' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      {/* Version dashboard */}
      <div className="mb-4 rounded-md border border-paper-soft/20 bg-black/20 p-3 font-mono text-xs text-paper-soft">
        <span className="text-paper">{APP_VERSION.version}</span>
        {' · sha '}
        <span className="text-paper">{APP_VERSION.sha}</span>
        {' · built '}
        <span className="text-paper">{APP_VERSION.builtAt}</span>
      </div>

      <p className="mb-4 text-xs text-paper-soft">{l.copyright}</p>

      <div className="grid grid-cols-2 gap-3">
        <NavTile
          colour="pink"
          label="Licence"
          icon={Scale}
          onActivate={(el) => open(el, 'GNU Affero General Public License v3.0', AGPL_MD)}
          meta="AGPLv3"
        />
        <NavTile
          colour="pink"
          label="Source Code"
          icon={ExternalLink}
          onActivate={() => window.open(l.sourceHref, '_blank', 'noopener,noreferrer')}
          meta="on GitHub"
        />
        <NavTile
          colour="green"
          label="Privacy"
          icon={ShieldCheck}
          onActivate={(el) => open(el, 'Privacy & data handling', PRIVACY_MD)}
          meta="what we store"
        />
        <NavTile
          colour="green"
          label="Third-party libraries"
          icon={Library}
          onActivate={(el) => open(el, 'Third-party libraries', renderThirdPartyMarkdown())}
          meta="open source"
        />
        {import.meta.env.DEV ? (
          <NavTile
            colour="purple"
            label="Developer tools"
            icon={Wrench}
            to="/app/account/about/devtools"
            meta="debug"
            wide
          />
        ) : null}
      </div>

      <ReadingOverlay
        open={reader !== null}
        title={reader?.title ?? ''}
        markdown={reader?.markdown ?? ''}
        onClose={() => setReader(null)}
        triggerRef={triggerRef}
      />
    </PageScaffold>
  );
}
