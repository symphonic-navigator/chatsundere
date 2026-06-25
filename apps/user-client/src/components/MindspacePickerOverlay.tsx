// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import type { MindspaceRow, MindspaceTexture } from '../boot/client-data-db.js';
import { type Font, MindspacePicker } from './MindspacePicker.js';
import { PickerOverlay } from './ui/PickerOverlay.js';

export interface MindspaceSelection {
  mindspaceId: string | null;
  texture: MindspaceTexture;
  font: Font; // 'sans' | 'serif' | 'cursive'
}

export interface MindspacePickerOverlayProps {
  open: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  mindspaces: ReadonlyArray<MindspaceRow>;
  previewName: string;
  initial: MindspaceSelection;
  allowUserDefault?: boolean;
  hideFont?: boolean;
  onSave: (next: MindspaceSelection) => void;
}

/**
 * The Mindspace picker (spec §3): the existing MindspacePicker staged inside the
 * shared shell. Local state is seeded from `initial` on open; Save commits all
 * three knobs at once; a dirty dismissal is discard-guarded by PickerOverlay.
 */
export function MindspacePickerOverlay({
  open,
  onClose,
  triggerRef,
  mindspaces,
  previewName,
  initial,
  allowUserDefault,
  hideFont,
  onSave,
}: MindspacePickerOverlayProps): JSX.Element {
  const [draft, setDraft] = useState<MindspaceSelection>(initial);
  const wasOpen = useRef(false);

  // Re-seed only on the closed→open transition, not on every identity change of
  // `initial` while the sheet is already open — prevents call-site re-renders from
  // clobbering a staged but unsaved edit.
  useEffect(() => {
    if (open && !wasOpen.current) setDraft(initial);
    wasOpen.current = open;
  }, [open, initial]);

  const dirty =
    draft.mindspaceId !== initial.mindspaceId ||
    draft.texture !== initial.texture ||
    draft.font !== initial.font;

  return (
    <PickerOverlay
      open={open}
      title="Mindspace"
      onClose={onClose}
      triggerRef={triggerRef}
      onSave={() => onSave(draft)}
      saveDisabled={!dirty}
      dirty={dirty}
    >
      <div className="p-4">
        <MindspacePicker
          mindspaces={mindspaces}
          selectedMindspaceId={draft.mindspaceId}
          selectedTexture={draft.texture}
          selectedFont={draft.font}
          previewName={previewName}
          allowUserDefault={allowUserDefault}
          hideFont={hideFont}
          onMindspaceChange={(mindspaceId) => setDraft((d) => ({ ...d, mindspaceId }))}
          onTextureChange={(texture) => setDraft((d) => ({ ...d, texture }))}
          onFontChange={(font) => setDraft((d) => ({ ...d, font }))}
        />
      </div>
    </PickerOverlay>
  );
}
