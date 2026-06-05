// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScrollToEnd } from '../../src/components/chat/ScrollToEnd';

describe('ScrollToEnd data-visible attribute', () => {
  it('renders with data-visible="true" when visible', () => {
    const { container } = render(<ScrollToEnd visible={true} onTap={vi.fn()} />);
    const el = container.querySelector('.scroll-to-end') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-visible')).toBe('true');
  });

  it('renders with data-visible="false" when not visible', () => {
    const { container } = render(<ScrollToEnd visible={false} onTap={vi.fn()} />);
    const el = container.querySelector('.scroll-to-end') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-visible')).toBe('false');
  });
});
