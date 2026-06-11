// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceTransport } from '../../../src/components/chat/VoiceTransport.js';

function callbacks() {
  return {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onSkip: vi.fn(),
    onResumePlayback: vi.fn(),
    onStartOver: vi.fn(),
    onDismiss: vi.fn(),
  };
}

describe('VoiceTransport', () => {
  it('renders null when idle without a resume offer', () => {
    const { container } = render(
      <VoiceTransport state="idle" resumeOffer={null} {...callbacks()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('speaking shows pause + stop and wires them', () => {
    const cb = callbacks();
    render(<VoiceTransport state="speaking" resumeOffer={null} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /Pause reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Stop reading/ }));
    expect(cb.onPause).toHaveBeenCalledTimes(1);
    expect(cb.onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Resume reading/ })).toBeNull();
  });

  it('paused shows resume + stop', () => {
    const cb = callbacks();
    render(<VoiceTransport state="paused" resumeOffer={null} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /Resume reading/ }));
    expect(cb.onResume).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Stop reading/ })).toBeInTheDocument();
  });

  it('failed shows the note plus Retry / Skip / Stop', () => {
    const cb = callbacks();
    render(<VoiceTransport state="failed" resumeOffer={null} {...cb} />);
    expect(screen.getByText(/Couldn't read this part aloud/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry reading this part/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip this part/ }));
    fireEvent.click(screen.getByRole('button', { name: /Stop reading/ }));
    expect(cb.onRetry).toHaveBeenCalledTimes(1);
    expect(cb.onSkip).toHaveBeenCalledTimes(1);
    expect(cb.onStop).toHaveBeenCalledTimes(1);
  });

  it('ended-partial shows the closing note plus Retry / Dismiss', () => {
    const cb = callbacks();
    render(<VoiceTransport state="ended-partial" resumeOffer={null} {...cb} />);
    expect(screen.getByText(/Couldn't finish reading aloud — Retry\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(cb.onRetry).toHaveBeenCalledTimes(1);
    expect(cb.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('idle + resume offer shows "Resume · ¶k" and "Start over"', () => {
    const cb = callbacks();
    render(<VoiceTransport state="idle" resumeOffer={{ paragraphLabel: '¶3' }} {...cb} />);
    fireEvent.click(screen.getByRole('button', { name: /Resume reading from ¶3/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
    expect(cb.onResumePlayback).toHaveBeenCalledTimes(1);
    expect(cb.onStartOver).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Resume · ¶3')).toBeInTheDocument();
  });
});
