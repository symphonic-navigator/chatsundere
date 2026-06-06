// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ReadingToolStrip } from '../../src/components/chat/ReadingToolStrip.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

test('expanded strip shows an artefacts button that fires onOpenArtefacts', () => {
  useCurrentChatStore.setState({ isToolStripExpanded: true });
  const onOpenArtefacts = vi.fn();
  render(<ReadingToolStrip onOpenToc={vi.fn()} onOpenArtefacts={onOpenArtefacts} />);
  fireEvent.click(screen.getByRole('button', { name: /artefacts/i }));
  expect(onOpenArtefacts).toHaveBeenCalled();
});
