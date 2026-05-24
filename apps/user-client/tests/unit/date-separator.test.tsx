import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DateSeparator } from '../../src/components/chat/DateSeparator';

describe('DateSeparator', () => {
  it('renders label between two lines', () => {
    const { container } = render(<DateSeparator label="Today" />);
    const sep = container.querySelector('[role="separator"]');
    expect(sep).not.toBeNull();
    expect(sep?.getAttribute('aria-label')).toBe('Today');
    expect(sep?.textContent).toContain('Today');
    expect(sep?.querySelectorAll('.date-sep-line').length).toBe(2);
  });
});
