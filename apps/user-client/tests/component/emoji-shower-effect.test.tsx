// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmojiShowerEffect } from '../../src/components/effects/EmojiShowerEffect.js';

describe('EmojiShowerEffect', () => {
  it('renders the full profile count of the chosen emoji', () => {
    render(<EmojiShowerEffect emoji={['🔥', '🦊']} reducedMotion={false} onDone={() => {}} />);
    // 40 particles cycling through the 2 emoji.
    expect(screen.getAllByText(/🔥|🦊/)).toHaveLength(40);
  });

  it('renders far fewer particles under reduced motion', () => {
    render(<EmojiShowerEffect emoji={['💖']} reducedMotion={true} onDone={() => {}} />);
    expect(screen.getAllByText('💖')).toHaveLength(4);
  });

  it('calls onDone via the safety timeout', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<EmojiShowerEffect emoji={['✨']} reducedMotion={true} onDone={onDone} />);
    vi.advanceTimersByTime(10_000);
    expect(onDone).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
