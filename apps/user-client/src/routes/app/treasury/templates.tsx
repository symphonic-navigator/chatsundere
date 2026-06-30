// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ListRow } from '../../../components/ui/ListRow.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useFilteredSeedTemplates } from '../../../data/seed-templates.js';

/** Level-1 Treasury surface: the saved primer templates (context pre-seeding). */
export function TreasuryTemplatesList(): JSX.Element {
  const navigate = useNavigate();
  const { data: templates } = useFilteredSeedTemplates();
  const { onHelp, helpOverlay } = useHelp('treasury-templates');

  const rows = templates ?? [];

  return (
    <PageScaffold
      crumbs={[{ label: 'My Treasury', to: '/app/treasury' }, { label: 'Templates' }]}
      back="/app/treasury"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <p className="text-[11px] text-paper-soft">
          Saved primers you can apply from a new, empty chat — a greeting and a short back-and-forth
          that sets the scene before your first message.
        </p>
        <div className="flex items-center justify-between gap-3">
          <Button tone="primary" onClick={() => navigate('/app/treasury/templates/new')}>
            + Add
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-paper-soft">
            No templates yet — create one to prime a fresh chat, or use “Save as template” from a
            message’s ⋯ menu.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((t) => {
              const turns = t.body.length;
              const meta = t.greeting ? `greeting · ${turns} turns` : `${turns} turns`;
              return (
                <ListRow
                  key={t.id}
                  title={t.name || 'Untitled template'}
                  subtitle={t.description || undefined}
                  trailing={
                    <span className="flex items-center gap-2">
                      {t.nsfw ? <Badge tone="danger">NSFW</Badge> : null}
                      <Badge tone="neutral">{meta}</Badge>
                    </span>
                  }
                  onOpen={() => navigate(`/app/treasury/templates/${t.id}`)}
                />
              );
            })}
          </div>
        )}
      </div>
    </PageScaffold>
  );
}
