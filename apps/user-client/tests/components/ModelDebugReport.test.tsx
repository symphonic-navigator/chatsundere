// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelDebugReport } from '../../src/components/ModelDebugReport.js';
import type { DiagnosticReport } from '../../src/lib/model-debug.js';

const REPORT: DiagnosticReport = {
  kind: 'test',
  provider: {
    displayName: 'nano-gpt',
    routing: 'cors-proxy',
    targetHost: 'api.nano-gpt.com',
    proxyHost: 'proxy',
  },
  model: 'anthropic/claude-sonnet-4.6',
  whenIso: '2026-06-28T14:03:00.000Z',
  env: {
    userAgent: 'TestAgent/1.0',
    platform: 'iPhone · crossOriginIsolated: false',
    crossOriginIsolated: false,
    online: true,
    timeZone: 'America/New_York',
  },
  response: {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/event-stream', 'content-encoding': 'gzip' },
  },
  timeline: [{ atMs: 0, text: 'request sent → POST https://proxy/x' }],
  chunkCount: 1,
  replyText: '1\n2',
  outcome: 'failed',
  outcomeDetail: 'stream stalled then errored',
  error: '✗ ERROR TypeError: Load failed',
  totalMs: 16300,
};

describe('ModelDebugReport', () => {
  it('renders the warm top line, the what-next line, and the report body', () => {
    render(<ModelDebugReport report={REPORT} />);
    expect(screen.getByText(/Thanks for this/i)).toBeInTheDocument();
    expect(screen.getByText(/Paste this into your reply to us/i)).toBeInTheDocument();
    expect(screen.getByText(/anthropic\/claude-sonnet-4\.6/)).toBeInTheDocument();
  });

  it('copies the formatted report to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ModelDebugReport report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('=== Chatsundere Model Test ==='),
    );
  });
});
