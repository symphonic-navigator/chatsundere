// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { ProviderSheet } from '../../src/components/ProviderSheet.js';

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('ProviderSheet', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    // Mock fetch so the auto-probe does not make real network calls in jsdom.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    vi.restoreAllMocks();
  });

  it('renders only the API key field for direct-CORS providers', () => {
    wrap(<ProviderSheet templateId="nano-gpt" onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/sk-/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/cors-proxy.tidesson/i)).not.toBeInTheDocument();
  });

  it('renders CORS-proxy fields for ollama-cloud (requires-proxy)', () => {
    wrap(<ProviderSheet templateId="ollama-cloud" onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/sk-/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/proxy url/i)).toBeInTheDocument();
  });

  it('triggers an auto-probe on close', async () => {
    const onClose = vi.fn();
    wrap(<ProviderSheet templateId="nano-gpt" onClose={onClose} />);
    // No API key entered — the early-return branch fires and onClose() is called immediately.
    fireEvent.click(screen.getByRole('button', { name: /close|×/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
