import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomAffordance } from '../../src/components/chat/BottomAffordance';

describe('BottomAffordance', () => {
  it('renders a button that fires onTap', () => {
    const onTap = vi.fn();
    const { container } = render(<BottomAffordance onTap={onTap} />);
    const btn = container.querySelector('.affordance');
    expect(btn).not.toBeNull();
    if (btn) fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('carries the .bottom-affordance class for CSS-driven breathing', () => {
    const onTap = vi.fn();
    const { container } = render(<BottomAffordance onTap={onTap} />);
    const el = container.querySelector('.bottom-affordance');
    expect(el).not.toBeNull();
  });
});
