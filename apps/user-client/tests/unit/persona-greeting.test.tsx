import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonaGreeting } from '../../src/components/chat/PersonaGreeting';

describe('PersonaGreeting', () => {
  it('renders persona name + "is listening" suffix', () => {
    const { container } = render(<PersonaGreeting name="Aurum" font="serif" colour="#c9a84c" />);
    expect(container.textContent).toContain('Aurum');
    expect(container.textContent).toContain('is listening');
  });

  it('applies persona colour inline', () => {
    const { container } = render(<PersonaGreeting name="X" font="serif" colour="#abcdef" />);
    const el = container.querySelector('.persona-greeting') as HTMLElement;
    // jsdom normalises to rgb()
    expect(el.style.color.replace(/\s/g, '').toLowerCase()).toContain('rgb(171,205,239)');
  });

  it('applies font family for each persona font', () => {
    const fonts = ['sans', 'serif', 'cursive'] as const;
    for (const f of fonts) {
      const { container } = render(<PersonaGreeting name="X" font={f} colour="#fff" />);
      const el = container.querySelector('.persona-greeting') as HTMLElement;
      expect(el.style.fontFamily).toBeTruthy();
    }
  });

  it('uses opacity 0.4 inline', () => {
    const { container } = render(<PersonaGreeting name="X" font="serif" colour="#fff" />);
    const el = container.querySelector('.persona-greeting') as HTMLElement;
    expect(el.style.opacity).toBe('0.4');
  });

  it('renders no failure notice or Retry button when notice prop is unset', () => {
    render(<PersonaGreeting name="Aurum" font="serif" colour="#fff" />);
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('renders the failure notice and a Retry button when notice is set', () => {
    render(
      <PersonaGreeting
        name="Aurum"
        font="serif"
        colour="#fff"
        notice="Aurum couldn't compose the greeting"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText("Aurum couldn't compose the greeting")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('renders the failure notice but NO Retry button when onRetry is not provided', () => {
    render(
      <PersonaGreeting
        name="Aurum"
        font="serif"
        colour="#fff"
        notice="Aurum couldn't compose the greeting"
      />,
    );
    expect(screen.getByText("Aurum couldn't compose the greeting")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('calls onRetry when the Retry button is clicked', () => {
    const onRetry = vi.fn();
    render(
      <PersonaGreeting
        name="Aurum"
        font="serif"
        colour="#fff"
        notice="Aurum couldn't compose the greeting"
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
