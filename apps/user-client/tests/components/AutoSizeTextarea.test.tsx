// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AutoSizeTextarea } from '../../src/components/AutoSizeTextarea.js';

describe('AutoSizeTextarea', () => {
  it('renders the controlled value', () => {
    const { getByRole } = render(
      <AutoSizeTextarea value="hello" onChange={() => {}} aria-label="t" />,
    );
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('hello');
  });

  it('forwards onChange', () => {
    let value = '';
    const { getByRole } = render(
      <AutoSizeTextarea
        value={value}
        onChange={(next) => {
          value = next;
        }}
        aria-label="t"
      />,
    );
    fireEvent.change(getByRole('textbox'), { target: { value: 'updated' } });
    expect(value).toBe('updated');
  });

  it('respects minRows and maxRows on the rendered element', () => {
    const { getByRole } = render(
      <AutoSizeTextarea value="" onChange={() => {}} aria-label="t" minRows={3} maxRows={10} />,
    );
    const ta = getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.rows).toBe(3);
    expect(ta.style.maxHeight).not.toBe('');
  });

  it('renders disabled when disabled prop is true, and enabled when absent', () => {
    const { getByRole, rerender } = render(
      <AutoSizeTextarea value="" onChange={() => {}} aria-label="t" disabled={true} />,
    );
    expect(getByRole('textbox')).toBeDisabled();

    rerender(<AutoSizeTextarea value="" onChange={() => {}} aria-label="t" />);
    expect(getByRole('textbox')).not.toBeDisabled();
  });
});
