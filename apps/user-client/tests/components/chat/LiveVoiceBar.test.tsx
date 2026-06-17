// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { LiveVoiceBar } from '../../../src/components/chat/LiveVoiceBar.js';

const base = {
  fill: 0,
  level: 0,
  onHold() {},
  onResume() {},
  onSkip() {},
  onExit() {},
  onPressStart() {},
  onPressEnd() {},
  onTap() {},
};

describe('LiveVoiceBar', () => {
  test('Exit is present in every floor', () => {
    for (const floor of [
      'listening',
      'userSpeaking',
      'transcribing',
      'personaSpeaking',
      'held',
    ] as const) {
      const { unmount } = render(<LiveVoiceBar {...base} floor={floor} />);
      expect(screen.getByRole('button', { name: /exit voice/i })).toBeTruthy();
      unmount();
    }
  });
  test('Skip stays on screen but is enabled only while the persona speaks', () => {
    const { rerender } = render(<LiveVoiceBar {...base} floor="listening" />);
    // Present on every floor (stable layout), disabled when there is nothing to skip.
    expect((screen.getByRole('button', { name: /skip/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    rerender(<LiveVoiceBar {...base} floor="personaSpeaking" />);
    expect((screen.getByRole('button', { name: /skip/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  test('Hold and Skip stay on screen (disabled) during transcribing — no layout jump', () => {
    render(<LiveVoiceBar {...base} floor="transcribing" />);
    expect((screen.getByRole('button', { name: /hold/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /skip/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  test('the persona floor shows an interrupt affordance', () => {
    render(<LiveVoiceBar {...base} floor="personaSpeaking" />);
    expect(screen.getByRole('button', { name: /interrupt|take the floor/i })).toBeTruthy();
  });
  test('transcribing shows a cancel affordance', () => {
    render(<LiveVoiceBar {...base} floor="transcribing" />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });
  test('held shows Resume and the muted-mic note', () => {
    render(<LiveVoiceBar {...base} floor="held" />);
    expect(screen.getByRole('button', { name: /resume/i })).toBeTruthy();
    expect(screen.getByText(/held/i)).toBeTruthy();
  });
  test('sttFailed is non-ejecting: a try-again affordance and a constructive note', () => {
    const onResume = vi.fn();
    render(<LiveVoiceBar {...base} floor="sttFailed" onResume={onResume} />);
    const tryAgain = screen.getByRole('button', { name: /try again/i });
    expect(tryAgain).toBeTruthy();
    expect(screen.getByText(/couldn't hear that/i)).toBeTruthy();
    tryAgain.click();
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
