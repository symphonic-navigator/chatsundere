// SPDX-License-Identifier: AGPL-3.0-only
import { ModelSlotPicker } from '../../../components/ModelSlotPicker.js';
import { ImageGenerationSection } from '../../../components/image-gen/ImageGenerationSection.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useProviders } from '../../../data/providers.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { usableTemplateIds } from '../../../lib/usable-providers.js';

function parseModelRef(
  ref: string | null | undefined,
): { providerTemplateId: string; upstreamSlug: string } | null {
  if (!ref) return null;
  const idx = ref.indexOf(':');
  if (idx < 0) return null;
  return { providerTemplateId: ref.slice(0, idx), upstreamSlug: ref.slice(idx + 1) };
}

export function SettingsImagesPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-images');
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const { data: providerRows } = useProviders();
  const rows = providerRows ?? [];
  const configuredTemplateIds = usableTemplateIds(rows, !!settings?.corsProxy);
  const current = parseModelRef(settings?.substituteVisionModel);

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'Images' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      <div className="flex flex-col gap-6 px-4 pb-8 pt-2">
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm text-paper">Reading images</h2>
          <p className="text-[11px] text-paper-soft">
            When your active model can't see images, this model reads them for it. One global
            choice.
          </p>
          <ModelSlotPicker
            label="Image-reading model"
            emptyLabel="None — pick a vision model"
            filter="vision"
            providers={rows}
            configuredTemplateIds={configuredTemplateIds}
            current={current}
            onSelect={(sel) =>
              update.mutate({
                substituteVisionModel: `${sel.providerTemplateId}:${sel.upstreamSlug}`,
              })
            }
            onClear={() => update.mutate({ substituteVisionModel: null })}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-sm text-paper">Creating images</h2>
          <ImageGenerationSection />
        </section>
      </div>
    </PageScaffold>
  );
}
