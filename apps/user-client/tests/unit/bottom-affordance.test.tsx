import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomAffordance } from '../../src/components/chat/BottomAffordance';
import { ScrollToEnd } from '../../src/components/chat/ScrollToEnd';

describe('BottomAffordance', () => {
  it('renders a button that fires onTap', () => {
    const onTap = vi.fn();
    const { container } = render(<BottomAffordance onTap={onTap} />);
    const btn = container.querySelector('.affordance');
    expect(btn).not.toBeNull();
    if (btn) fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

describe('ScrollToEnd', () => {
  it('renders a button with "To end" label and fires onTap', () => {
    const onTap = vi.fn();
    const { container } = render(<ScrollToEnd onTap={onTap} />);
    const btn = container.querySelector('.scroll-to-end');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('To end');
    if (btn) fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
