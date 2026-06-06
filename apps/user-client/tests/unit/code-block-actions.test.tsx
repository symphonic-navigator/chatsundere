// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { CodeBlockActions } from '../../src/components/chat/markdown/CodeBlockActions.js';
import { ArtefactSaveContext } from '../../src/components/chat/markdown/artefact-save-context.js';

test('no Save button without a save context (Copy still present)', () => {
  render(<CodeBlockActions codeStr="print(1)" lang="python" />);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
});

test('Save calls saveCodeBlock with the code and language', () => {
  const saveCodeBlock = vi.fn();
  render(
    <ArtefactSaveContext.Provider value={{ chatId: 'c1', personaId: 'p1', saveCodeBlock }}>
      <CodeBlockActions codeStr="print(1)" lang="python" />
    </ArtefactSaveContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(saveCodeBlock).toHaveBeenCalledWith({ content: 'print(1)', lang: 'python' });
});
