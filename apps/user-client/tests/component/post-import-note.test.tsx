// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PostImportNote } from '../../src/components/persona-editor/PostImportNote.js';

it('shows the model clause only when unbound and the bindings clause only when dropped', () => {
  const { rerender } = render(<PostImportNote modelBound={false} droppedBindings={true} />);
  expect(screen.getByText(/pick a model/i)).toBeInTheDocument();
  expect(screen.getByText(/library links and mcp/i)).toBeInTheDocument();

  rerender(<PostImportNote modelBound={true} droppedBindings={false} />);
  expect(screen.queryByText(/pick a model/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/library links and mcp/i)).not.toBeInTheDocument();
});
