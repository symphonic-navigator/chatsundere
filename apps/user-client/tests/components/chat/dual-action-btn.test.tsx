// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DualActionBtn } from '../../../src/components/chat/DualActionBtn.js';

describe('DualActionBtn', () => {
  it('does not send while a send is already in flight (isSending)', () => {
    const onSend = vi.fn();
    render(
      <DualActionBtn hasText isStreamLive={false} isSending personaName="Aria" onSend={onSend} />,
    );
    const btn = screen.getByRole('button');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends when idle with text', () => {
    const onSend = vi.fn();
    render(
      <DualActionBtn
        hasText
        isStreamLive={false}
        isSending={false}
        personaName="Aria"
        onSend={onSend}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
