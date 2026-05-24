// SPDX-License-Identifier: AGPL-3.0-only

import { InlineMarker } from '@chatsundere/ui-shared';
import { copy } from '../../../lib/copy.js';
import { APP_VERSION } from '../../../version.js';

/**
 * About accordion body.
 *
 * Displays app version (injected at build time via Vite `define`), licence,
 * and a documentation link placeholder.
 */
export function AboutSection() {
  return (
    <div className="space-y-8">
      <dl className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
            {copy.settings.about.versionLabel}
          </dt>
          <dd>
            <InlineMarker tone="default">{APP_VERSION}</InlineMarker>
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
            {copy.settings.about.licenceLabel}
          </dt>
          <dd className="text-sm text-paper">{copy.settings.about.licenceValue}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
            {copy.settings.about.docsLabel}
          </dt>
          <dd>
            <a
              href={`https://${copy.settings.about.docsValue}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-aurora-300 underline-offset-2 hover:underline"
            >
              {copy.settings.about.docsValue}
            </a>
          </dd>
        </div>
      </dl>
    </div>
  );
}
