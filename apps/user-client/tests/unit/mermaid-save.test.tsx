// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { MermaidBlock } from '../../src/components/chat/markdown/MermaidBlock.js';
import { ArtefactSaveContext } from '../../src/components/chat/markdown/artefact-save-context.js';

test('Mermaid shows a Save button when a save context is present', () => {
  const saveCodeBlock = vi.fn();
  render(
    <ArtefactSaveContext.Provider value={{ chatId: 'c1', personaId: 'p1', saveCodeBlock }}>
      <MermaidBlock code={'graph TD; A-->B'} />
    </ArtefactSaveContext.Provider>,
  );
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
});

test('Mermaid has no Save button without a context', () => {
  render(<MermaidBlock code={'graph TD; A-->B'} />);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});
