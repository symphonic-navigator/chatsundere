// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpApprovalPrompt } from '../../../src/components/mcp/McpApprovalPrompt.js';
import { useMcpApprovalStore } from '../../../src/state/mcp-approval.store.js';

vi.mock('../../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: [] }),
  useUpsertMcpServer: () => ({ mutate: vi.fn() }),
}));

beforeEach(() => useMcpApprovalStore.setState({ pending: [] }));

function wrap(ui: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('McpApprovalPrompt', () => {
  it('renders nothing when there is no pending request', () => {
    const { container } = render(wrap(<McpApprovalPrompt />));
    expect(container).toBeEmptyDOMElement();
  });

  it('approves the pending request', async () => {
    const p = useMcpApprovalStore
      .getState()
      .request({ serverId: 's', serverName: 'GitHub', toolName: 'search', args: { q: 'x' } });
    render(wrap(<McpApprovalPrompt />));
    expect(screen.getByText(/wants to run/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await expect(p).resolves.toBe(true);
  });
});
