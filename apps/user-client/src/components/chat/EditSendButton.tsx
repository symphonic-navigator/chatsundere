// SPDX-License-Identifier: AGPL-3.0-only
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
 */
export function EditSendButton(p: Props): JSX.Element {
  if (p.canReplace) {
    const secondary: OverflowItem[] = [
      { label: 'Branch to a new chat instead', onSelect: p.onBranch },
    ];
    return (
      <div className="edit-send">
        <button type="button" className="edit-send-primary" onClick={p.onReplace} disabled={p.busy}>
          Replace
        </button>
        <OverflowMenu items={secondary} triggerLabel="More send options" />
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
      <button type="button" className="edit-send-primary" onClick={p.onBranch} disabled={p.busy}>
        Branch to a new chat
      </button>
      <OverflowMenu items={secondary} triggerLabel="More send options" />
    </div>
  );
}
