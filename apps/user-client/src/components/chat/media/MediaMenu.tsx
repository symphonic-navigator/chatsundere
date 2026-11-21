// SPDX-License-Identifier: AGPL-3.0-only
import { type OverflowItem, OverflowMenu } from '../../ui/OverflowMenu.js';
import { mediaCopy } from './media-copy.js';

/**
 * The "⋯" menu of a player. Download stays visible while the bytes are not on this device,
 * greyed out with the reason; Open in Treasury appears only where there is a Treasury to go to.
 */
export function MediaMenu({
  title,
  onDownload,
  downloadDisabledReason,
  onOpenInTreasury,
}: {
  title: string;
  onDownload: () => void;
  /** Set while the bytes are missing; the item is then disabled with this reason. */
  downloadDisabledReason: string | null;
  onOpenInTreasury?: () => void;
}): JSX.Element {
  const items: OverflowItem[] = [
    {
      label: mediaCopy.download,
      onSelect: onDownload,
      disabled: downloadDisabledReason !== null,
      ...(downloadDisabledReason !== null ? { disabledReason: downloadDisabledReason } : {}),
    },
  ];
  if (onOpenInTreasury) items.push({ label: mediaCopy.openInTreasury, onSelect: onOpenInTreasury });
  return (
    <span className="media-menu">
      <OverflowMenu items={items} triggerLabel={mediaCopy.more(title)} />
    </span>
  );
}
