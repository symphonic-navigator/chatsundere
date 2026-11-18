// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useRef, useState } from 'react';
import {
  MindspacePickerOverlay,
  type MindspaceSelection,
} from '../../../components/MindspacePickerOverlay.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { PickerField } from '../../../components/ui/PickerField.js';
import { useHelp } from '../../../content/help/use-help.js';
import { useMindspaces } from '../../../data/mindspaces.js';
import { useSettings, useUpdateSettings } from '../../../data/settings.js';
import { useSystemReducedMotion } from '../../../lib/reduced-motion.js';
import { InlineEditTextarea } from './InlineEditTextarea.js';

/**
 * "Reduce animations": the per-device `animationsEnabled` field, inverted. The
 * system's reduced-motion setting wins and holds the switch on; the user's own
 * choice is kept underneath and shows again once the system lets go.
 */
function ReduceAnimationsSwitch({
  animationsEnabled,
  onChange,
}: {
  animationsEnabled: boolean;
  onChange: (animationsEnabled: boolean) => void;
}): JSX.Element {
  const systemReduced = useSystemReducedMotion();
  const pressed = systemReduced || !animationsEnabled;
  const helperId = useId();
  const noteId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm text-paper">Reduce animations</div>
        <p id={helperId} className="text-[11px] text-paper-soft">
          Stills the drifting background, the breathing orbs and other motion on this device. Screen
          effects play gently.
        </p>
        {systemReduced ? (
          <p id={noteId} className="mt-1 text-[11px] text-paper-soft">
            Your device asks for reduced motion, so this stays on. Change it in your system
            settings.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Reduce animations"
        aria-pressed={pressed}
        aria-describedby={systemReduced ? `${helperId} ${noteId}` : helperId}
        disabled={systemReduced}
        onClick={() => onChange(!animationsEnabled)}
        className={`h-6 w-12 shrink-0 rounded-full border ${
          pressed ? 'border-paper bg-paper/30' : 'border-paper-soft/30 bg-white/5'
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-paper transition-transform ${
            pressed ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/** My Settings › You — AI-facing identity: about-me, global instructions, mindspace, motion. */
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
        <ReduceAnimationsSwitch
          animationsEnabled={s.animationsEnabled}
          onChange={(next) => void update.mutateAsync({ animationsEnabled: next })}
        />
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
