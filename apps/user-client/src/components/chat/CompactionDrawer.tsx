// SPDX-License-Identifier: AGPL-3.0-only
import type { JSX } from 'react';
import type { CompactionCheckpointRow } from '../../boot/client-data-db.js';
import { MarkdownContent } from './markdown/MarkdownContent.js';

/**
 * Read-only drawer that renders the compaction briefing as Markdown, followed
 * by a calm note explaining how to refresh it.
 */
export function CompactionDrawer({
  checkpoint,
}: { checkpoint: CompactionCheckpointRow }): JSX.Element {
  return (
    <section className="compaction-drawer" aria-label="Compaction briefing">
      <div className="compaction-drawer-body">
        <MarkdownContent text={checkpoint.summaryMarkdown} />
      </div>
      <p className="compaction-drawer-note">
        This briefing is generated from the conversation. To refresh it, compact again.
      </p>
    </section>
  );
}
