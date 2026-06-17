// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceTransport } from '../../src/components/chat/VoiceTransport.js';

const base = {
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
} as const;

describe('<VoiceTransport> monologue mode', () => {
  it('hides Skip, labels the exit "Stop", and shows the thinking-aloud note', () => {
    render(<VoiceTransport {...base} mode="monologue" state="speaking" />);
    expect(screen.queryByLabelText('Skip this part')).toBeNull();
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.queryByText('Exit')).toBeNull();
    expect(screen.getByText('thinking aloud…')).toBeInTheDocument();
  });

  it('default read-aloud mode still shows Skip and Exit', () => {
    render(<VoiceTransport {...base} state="speaking" />);
    expect(screen.getByLabelText('Skip this part')).toBeInTheDocument();
    expect(screen.getByText('Exit')).toBeInTheDocument();
    expect(screen.queryByText('thinking aloud…')).toBeNull();
  });

  it('hides Pause during synthesis (waiting) in monologue mode, keeping Stop', () => {
    render(<VoiceTransport {...base} mode="monologue" state="waiting" />);
    expect(screen.queryByLabelText('Pause reading')).toBeNull();
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.getByText('thinking aloud…')).toBeInTheDocument();
  });
});
