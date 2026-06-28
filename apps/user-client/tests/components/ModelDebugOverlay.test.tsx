// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelDebugOverlay } from '../../src/components/ModelDebugOverlay.js';
import type { DiagnosticReport } from '../../src/lib/model-debug.js';

const OFFERINGS = [
  { upstreamSlug: 'anthropic/claude-sonnet-4.6', serviceKind: 'llm' },
  { upstreamSlug: 'meta/llama-3', serviceKind: 'llm' },
  { upstreamSlug: 'some/tts-voice', serviceKind: 'tts' },
] as unknown as React.ComponentProps<typeof ModelDebugOverlay>['offerings'];

const REPORT: DiagnosticReport = {
  kind: 'test',
  provider: { displayName: 'p', routing: 'direct', targetHost: 'h' },
  model: 'anthropic/claude-sonnet-4.6',
  whenIso: '2026-06-28T14:03:00.000Z',
  env: { userAgent: 'x', platform: 'x', crossOriginIsolated: false, online: true, timeZone: 'x' },
  timeline: [],
  chunkCount: 0,
  replyText: '',
  outcome: 'success',
  outcomeDetail: 'ok',
  totalMs: 1,
};

describe('ModelDebugOverlay', () => {
  it('lists only llm offerings and runs the chosen model', async () => {
    const run = vi.fn().mockResolvedValue(REPORT);
    render(
      <ModelDebugOverlay
        open
        providerDisplayName="p"
        offerings={OFFERINGS}
        onClose={() => {}}
        runTest={run}
      />,
    );
    expect(screen.queryByText('some/tts-voice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('anthropic/claude-sonnet-4.6'));
    fireEvent.click(screen.getByRole('button', { name: /run streaming test/i }));
    // The label flips to "Running…" and the button disables while the promise is pending.
    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled();
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]?.[0]?.upstreamSlug).toBe('anthropic/claude-sonnet-4.6');
    await screen.findByText(/Copy report/i);
  });

  it('disables run until a model is chosen', () => {
    render(
      <ModelDebugOverlay
        open
        providerDisplayName="p"
        offerings={OFFERINGS}
        onClose={() => {}}
        runTest={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /run streaming test/i })).toBeDisabled();
  });
});
