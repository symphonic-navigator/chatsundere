// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { exportLibrary } from '../../data/chatsundere-export.js';
import {
  type EncryptFormState,
  INITIAL_ENCRYPT_FORM,
  resolveExportPassword,
} from '../../lib/chatsundere-transfer/encryption-form.js';
import { slug, triggerDownload } from '../../lib/download.js';
import { toastStore } from '../../state/toast.store.js';
import { Button } from '../ui/Button.js';
import { EncryptExportSection } from './EncryptExportSection.js';

export interface LibraryExportOverlayProps {
  libraryId: string;
  libraryName: string;
  onClose: () => void;
}

/**
 * Transient export overlay for a knowledge library. Its only option is optional
 * password encryption (off by default → one-tap plaintext export).
 */
export function LibraryExportOverlay({
  libraryId,
  libraryName,
  onClose,
}: LibraryExportOverlayProps): JSX.Element {
  const [enc, setEnc] = useState<EncryptFormState>(INITIAL_ENCRYPT_FORM);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const resolved = resolveExportPassword(enc);

  async function handleExport(): Promise<void> {
    if (!resolved.ok) return;
    setExporting(true);
    try {
      const blob = resolved.password
        ? await exportLibrary(libraryId, resolved.password)
        : await exportLibrary(libraryId);
      const suffix = resolved.password ? '-chatsundere-encrypted.tar.gz' : '-chatsundere.tar.gz';
      triggerDownload(blob, `${slug(libraryName)}${suffix}`);
      toastStore.show({ message: 'Library exported', tone: 'success', durationMs: 3000 });
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
  const dialogLabel = `Export ${libraryName}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives the zoom animation; <dialog> requires showModal()
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={dialogLabel}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape handled on document */}
      <div className="cs-dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title">Export {libraryName}</div>
        <div className="mb-4 mt-2">
          <EncryptExportSection state={enc} onChange={setEnc} />
          {!resolved.ok ? (
            <p className="mt-2 text-[11px] text-amber-300/80">{resolved.reason}</p>
          ) : null}
        </div>
        <div className="cs-dialog-actions">
          <Button tone="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="primary"
            priority
            disabled={exporting || !resolved.ok}
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
