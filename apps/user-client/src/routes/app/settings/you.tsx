// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import {
  MindspacePickerOverlay,
  type MindspaceSelection,
} from '../../../components/MindspacePickerOverlay.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { PickerField } from '../../../components/ui/PickerField.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { InlineEditTextarea } from './InlineEditTextarea.js';

/** My Settings › You — AI-facing identity: about-me, global instructions, mindspace. */
export function SettingsYouPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('settings-you');
  const settings = useSettings();
  const update = useUpdateSettings();
  const mindspaces = useMindspaces();
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const body = (() => {
    if (!settings.data || !mindspaces.data) {
      return <div className="p-4 text-paper-soft">Loading…</div>;
    }
    const s = settings.data;
    const selected = mindspaces.data.find((m) => m.id === s.defaultMindspaceId);
    const initial: MindspaceSelection = {
      mindspaceId: s.defaultMindspaceId,
      texture: s.userTexture,
      font: 'sans',
    };
    return (
      <div className="flex flex-col gap-6 px-4 pb-8 pt-2">
        <InlineEditTextarea
          label="About me"
          value={s.globalAboutMe}
          placeholder="Tell your Circle who you are…"
          helper="Included in every persona's system prompt unless overridden per-persona."
          onSave={(v) => update.mutateAsync({ globalAboutMe: v })}
        />
        <InlineEditTextarea
          label="Global instructions"
          value={s.globalInstructions}
          helper="Added to every persona's system prompt — always global, no per-persona override."
          onSave={(v) => update.mutateAsync({ globalInstructions: v })}
        />
        <div className="flex flex-col gap-1">
          <PickerField
            label="Mindspace"
            value={selected?.displayName ?? 'Default'}
            onOpen={(el) => {
              triggerRef.current = el;
              setPickerOpen(true);
            }}
          />
        </div>
        <MindspacePickerOverlay
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          triggerRef={triggerRef}
          mindspaces={mindspaces.data}
          previewName={s.displayName?.trim() || 'You'}
          initial={initial}
          hideFont
          onSave={(next) => {
            void update.mutateAsync({
              defaultMindspaceId: next.mindspaceId ?? s.defaultMindspaceId,
              userTexture: next.texture,
            });
            setPickerOpen(false);
          }}
        />
      </div>
    );
  })();

  return (
    <PageScaffold
      crumbs={[{ label: 'My Settings', to: '/app/settings' }, { label: 'You' }]}
      back="/app/settings"
      onHelp={onHelp}
    >
      {helpOverlay}
      {body}
    </PageScaffold>
  );
}
