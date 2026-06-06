// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  ArtefactSaveContext,
  useArtefactSave,
} from '../../src/components/chat/markdown/artefact-save-context.js';

function Probe() {
  const save = useArtefactSave();
  return <div>{save ? `ctx:${save.chatId}/${save.personaId}` : 'no-ctx'}</div>;
}

test('useArtefactSave returns null with no provider', () => {
  render(<Probe />);
  expect(screen.getByText('no-ctx')).toBeTruthy();
});

test('useArtefactSave returns the provided value', () => {
  render(
    <ArtefactSaveContext.Provider
      value={{ chatId: 'c1', personaId: 'p1', saveCodeBlock: () => {} }}
    >
      <Probe />
    </ArtefactSaveContext.Provider>,
  );
  expect(screen.getByText('ctx:c1/p1')).toBeTruthy();
});
