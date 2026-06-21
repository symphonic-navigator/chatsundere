// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useEffect, useRef } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';
import { Button } from './Button.js';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive: gold→safe choice, red→confirm, red title (spec §5). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Element the dialog should zoom out of (spec §3). */
  triggerRef?: React.RefObject<HTMLElement>;
}

/**
 * The single, uniform confirmation/query dialog (spec §5). Layout A: secondary
 * left, gold action right. For destructive prompts the colour roles swap — gold
 * protects the safe choice, red stays on the destructive action, and the title
 * is marked so it is re-read rather than thumb-reflexed (Laura SOFT-1). Appears
 * via the Unified-Experience zoom and dismisses to the safe path on backdrop tap.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
  triggerRef,
}: ConfirmDialogProps): JSX.Element | null {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const card = cardRef.current;
    const trigger = triggerRef?.current;
    if (card && trigger) {
      const stage = card.offsetParent as HTMLElement | null;
      if (stage) {
        card.style.transformOrigin = computeTransformOrigin(
          trigger.getBoundingClientRect(),
          stage.getBoundingClientRect(),
        );
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, triggerRef, onCancel]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-dialog-root" role="dialog" aria-modal="true" aria-label={title}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to cancel; Escape is handled on document */}
      <div className="cs-dialog-backdrop" onClick={onCancel} />
      <div ref={cardRef} className="cs-dialog-card cs-zoom-in">
        <div className="cs-dialog-title" data-destructive={destructive ? 'true' : undefined}>
          {title}
        </div>
        {body ? <div className="cs-dialog-body">{body}</div> : null}
        <div className="cs-dialog-actions">
          <Button
            tone={destructive ? 'primary' : 'neutral'}
            priority={destructive}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            tone={destructive ? 'destructive' : 'primary'}
            priority={!destructive}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
