// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DualActionBtn } from '../../src/components/chat/DualActionBtn';
import { idleDictationStub } from '../helpers/dictation-stub';

describe('DualActionBtn', () => {
  it('renders a stop button and calls onStop while a stream is live', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const { getByRole } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={true}
        personaName="Aurum"
        onSend={onSend}
        onStop={onStop}
        dictation={idleDictationStub}
      />,
    );
    const btn = getByRole('button', { name: /stop/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends (not stops) when there is text and no live stream', () => {
    const onStop = vi.fn();
    const onSend = vi.fn();
    const { getByRole } = render(
      <DualActionBtn
        hasText={true}
        isStreamLive={false}
        personaName="Aurum"
        onSend={onSend}
        onStop={onStop}
        dictation={idleDictationStub}
      />,
    );
    const btn = getByRole('button', { name: 'Send' });
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });
});
