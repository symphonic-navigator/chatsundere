// SPDX-License-Identifier: AGPL-3.0-only
import type { SeedTemplateRow } from '../../boot/client-data-db.js';
import { useFilteredSeedTemplates } from '../../data/seed-templates.js';
import { Badge } from '../ui/Badge.js';
import { ListRow } from '../ui/ListRow.js';
import { PickerOverlay } from '../ui/PickerOverlay.js';

interface SeedTemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: SeedTemplateRow) => void;
}

/** Overlay that lists the applyable primer templates for an empty chat. */
export function SeedTemplatePicker({
  open,
  onClose,
  onSelect,
}: SeedTemplatePickerProps): JSX.Element {
  const { data: templates } = useFilteredSeedTemplates();
  const rows = templates ?? [];

  return (
    <PickerOverlay open={open} title="Seed from template" onClose={onClose}>
      <div className="flex flex-col gap-2 p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-paper-soft">
            No templates yet — create one in My Treasury → Templates.
          </p>
        ) : (
          rows.map((t) => {
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
                onOpen={() => onSelect(t)}
              />
            );
          })
        )}
      </div>
    </PickerOverlay>
  );
}
