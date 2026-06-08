// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagEditor } from '../../../src/components/artefact/TagEditor.js';
import { normalisePhrases } from '../../../src/lib/treasury-filter.js';

describe('TagEditor normalise prop', () => {
  it('uses the supplied normaliser (whitespace-collapsing) when adding', () => {
    const onChange = vi.fn();
    render(
      <TagEditor
        mode="edit"
        value={[]}
        suggestions={[]}
        onChange={onChange}
        normalise={normalisePhrases}
      />,
    );
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'Roter  Drache' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['roter drache']);
  });
});
