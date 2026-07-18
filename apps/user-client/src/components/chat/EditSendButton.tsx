// SPDX-License-Identifier: AGPL-3.0-only
import { GitBranch, RefreshCw } from 'lucide-react';
import { type OverflowItem, OverflowMenu } from '../ui/OverflowMenu.js';

interface Props {
  /** Whether the edited message is still the last user message. */
  canReplace: boolean;
  /** Reason Replace is unavailable, or null when it is. Shown on the disabled item. */
  disabledReason: string | null;
  onReplace: () => void;
  onBranch: () => void;
  busy: boolean;
}

/**
 * Context-aware split send control for an in-progress edit (spec §11.1).
 * Last message → primary Replace, caret → Branch. Not last → primary Branch,
 * caret → Replace shown *disabled with its reason* (never collapsed away — the
 * hard constraint that keeps the cross-device case honest).
 *
 * The primary action is an icon button mirroring the cockpit's send button so
 * the send position keeps one visual language: a regenerate glyph for Replace
 * (rerun the last turn), a branch glyph for Branch (fork a new chat). The edit
 * banner above the composer carries the words; the icons carry an aria-label
 * and title so the affordance stays legible without a text label.
 */
export function EditSendButton(p: Props): JSX.Element {
  if (p.canReplace) {
    const secondary: OverflowItem[] = [
      { label: 'Branch to a new chat instead', onSelect: p.onBranch },
    ];
    return (
      <div className="edit-send">
        <OverflowMenu items={secondary} triggerLabel="More send options" placement="up" />
        <button
          type="button"
          className="edit-send-primary"
          onClick={p.onReplace}
          disabled={p.busy}
          aria-label="Replace message"
          title="Replace message"
        >
          <RefreshCw size={20} aria-hidden="true" />
        </button>
      </div>
    );
  }
  const secondary: OverflowItem[] = [
    {
      label: 'Replace',
      disabled: true,
      disabledReason: p.disabledReason ?? 'Not available for an earlier message',
    },
  ];
  return (
    <div className="edit-send">
      <OverflowMenu items={secondary} triggerLabel="More send options" placement="up" />
      <button
        type="button"
        className="edit-send-primary"
        onClick={p.onBranch}
        disabled={p.busy}
        aria-label="Branch to a new chat"
        title="Branch to a new chat"
      >
        <GitBranch size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
