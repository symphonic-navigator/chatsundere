// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceTransport } from '../../../src/components/chat/VoiceTransport.js';

// Callbacks plus the non-callback defaults every render needs; explicit props
// after the spread override (e.g. `autoReadOn` for the armed tests).
function props() {
  return {
    resumeOffer: null,
    providerSkips: 0,
    autoReadOn: false,
    voiceUnavailable: null,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onSkip: vi.fn(),
    onRetry: vi.fn(),
    onResumePlayback: vi.fn(),
    onStartOver: vi.fn(),
    onDismiss: vi.fn(),
    onExitVoice: vi.fn(),
  };
}

describe('VoiceTransport visibility', () => {
  it('renders null when idle, not armed, no offer, no skips', () => {
    const { container } = render(<VoiceTransport state="idle" {...props()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the ready indicator when auto-read is armed (idle but voice mode on)', () => {
    render(<VoiceTransport state="idle" {...props()} autoReadOn />);
    // No explanatory text any more — the open toolbar plus the ready indicator
    // is signal enough; the toolbar stays compact.
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
  });
});

describe('VoiceTransport playing states', () => {
  it('speaking shows Pause + Skip and a constant Exit; wires them', () => {
    const p = props();
    render(<VoiceTransport state="speaking" {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Pause reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip this part/ }));
    fireEvent.click(screen.getByRole('button', { name: /Exit voice/ }));
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(p.onExitVoice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });

  it('waiting shows Pause + Skip live plus the reading… note', () => {
    const p = props();
    render(<VoiceTransport state="waiting" {...p} />);
    expect(screen.getByText(/reading…/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause reading/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Skip this part/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Exit voice/ })).toBeInTheDocument();
  });

  it('paused shows Resume + Skip + Exit', () => {
    const p = props();
    render(<VoiceTransport state="paused" {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Resume reading/ }));
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Skip this part/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exit voice/ })).toBeInTheDocument();
  });
});

describe('VoiceTransport armed states', () => {
  it('armed shows a ready indicator, a DISABLED Skip, and Exit (no greyed Pause)', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} autoReadOn />);
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip this part/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Pause reading/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Exit voice/ }));
    expect(p.onExitVoice).toHaveBeenCalledTimes(1);
  });

  it('armed-but-unavailable shows a greyed Pause + the reason, never silently hides', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} autoReadOn voiceUnavailable="no-voice" />);
    expect(screen.getByText(/Voice unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause reading/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Exit voice/ })).toBeInTheDocument();
  });
});

describe('VoiceTransport recovery + notices', () => {
  it('failed shows note + Retry + Skip + Exit', () => {
    const p = props();
    render(<VoiceTransport state="failed" {...p} />);
    expect(screen.getByText(/Couldn't read this part aloud/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip this part/ }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Exit voice/ })).toBeInTheDocument();
  });

  it('ended-partial shows note + Retry, and Dismiss (not Exit)', () => {
    const p = props();
    render(<VoiceTransport state="ended-partial" {...p} />);
    expect(screen.getByText(/Couldn't finish reading aloud/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry reading/ }));
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Exit voice/ })).toBeNull();
    // Skip is intentionally absent here — the read already ended, there is no
    // current segment to skip; lock that in so a future showSkip edit is caught.
    expect(screen.queryByRole('button', { name: /Skip this part/ })).toBeNull();
  });

  it('skip note shows mid-speaking with NO Dismiss (Exit stays)', () => {
    const p = props();
    render(<VoiceTransport state="speaking" {...p} providerSkips={1} />);
    expect(screen.getByText(/Skipped a passage the voice provider declined/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Exit voice/ })).toBeInTheDocument();
  });

  it('idle with skipped passages shows the plural note + Dismiss (not Exit)', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} providerSkips={2} />);
    expect(screen.getByText(/Skipped 2 passages the voice provider declined/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Exit voice/ })).toBeNull();
  });

  it('idle + resume offer shows the ¶ resume button, Start over, and Exit declines', () => {
    const p = props();
    render(<VoiceTransport state="idle" {...p} resumeOffer={{ paragraphLabel: '¶3' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Resume reading from ¶3/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start over/ }));
    fireEvent.click(screen.getByRole('button', { name: /Exit voice/ }));
    expect(p.onResumePlayback).toHaveBeenCalledTimes(1);
    expect(p.onStartOver).toHaveBeenCalledTimes(1);
    expect(p.onExitVoice).toHaveBeenCalledTimes(1);
    expect(screen.getByText('¶3')).toBeInTheDocument();
  });
});
