// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { exportPersona } from '../../data/chatsundere-export.js';
import { slug, triggerDownload } from '../../lib/download.js';
import { toastStore } from '../../state/toast.store.js';
import { Button } from '../ui/Button.js';

export interface ExportOverlayProps {
  personaId: string;
  personaName: string;
  onClose: () => void;
}

/**
 * Transient export overlay for a persona. Three toggles control which optional
 * data travels with the archive: Memory (on by default), Artefacts (on by
 * default), Images (off by default — image attachments become text placeholders
 * when excluded, preserving message context). Calls exportPersona, triggers a
 * browser download, shows a success toast, then closes.
 *
 * Modelled after the cs-dialog shell — same fixed-overlay + zoom-in card
 * pattern as ConfirmDialog, but with a form body instead of a confirmation body.
 */
export function ExportOverlay({
  personaId,
  personaName,
  onClose,
}: ExportOverlayProps): JSX.Element {
  const [memory, setMemory] = useState(true);
  const [artefacts, setArtefacts] = useState(true);
  const [images, setImages] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      const blob = await exportPersona(personaId, { memory, artefacts, images });
      triggerDownload(blob, `${slug(personaName)}-chatsundere.tar.gz`);
      toastStore.show({ message: 'Persona exported', tone: 'success', durationMs: 3000 });
      onClose();
    } catch (e) {
      toastStore.show({
        message: e instanceof Error ? e.message : 'Export failed',
        tone: 'warn',
        durationMs: 3500,
      });
      setExporting(false);
    }
  }

  // Extracted so the outer div fits on one line; the lint suppression below
  // must be on the line immediately preceding the opening tag.
  const dialogLabel = `Export ${personaName}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={dialogLabel}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape is handled on document */}
      <div className="cs-dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title">Export {personaName}</div>
        <div className="mb-4 mt-2 flex flex-col gap-3">
          <ToggleRow
            id="export-memory"
            label="Memory"
            subtitle="Your private memories from chats with this persona."
            checked={memory}
            onChange={setMemory}
          />
          <ToggleRow
            id="export-artefacts"
            label="Artefacts"
            subtitle="Text artefacts created during your chats."
            checked={artefacts}
            onChange={setArtefacts}
          />
          <ToggleRow
            id="export-images"
            label="Images"
            subtitle="Off: in-chat images become placeholders in the copy."
            checked={images}
            onChange={setImages}
          />
        </div>
        <div className="cs-dialog-actions">
          <Button tone="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            priority
            disabled={exporting}
            onClick={() => {
              void handleExport();
            }}
          >
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ id, label, subtitle, checked, onChange }: ToggleRowProps): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm text-paper">
          {label}
        </label>
        <p className="text-[11px] text-paper-soft">{subtitle}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 shrink-0 accent-paper"
      />
    </div>
  );
}
