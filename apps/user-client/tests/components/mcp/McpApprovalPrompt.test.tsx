// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpApprovalPrompt } from '../../../src/components/mcp/McpApprovalPrompt.js';
import { useMcpApprovalStore } from '../../../src/state/mcp-approval.store.js';

const { mutate, rows } = vi.hoisted(() => ({
  mutate: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: rows }),
  useUpsertMcpServer: () => ({ mutate }),
}));

beforeEach(() => {
  useMcpApprovalStore.setState({ pending: [] });
  mutate.mockReset();
  rows.length = 0;
});

const call = (over: { firstUse?: boolean } = {}) =>
  useMcpApprovalStore.getState().request({
    serverId: 's',
    serverName: 'GitHub',
    toolName: 'search',
    args: { q: 'needle' },
    host: 'api.github.example',
    firstUse: over.firstUse ?? false,
  });

function wrap(ui: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('McpApprovalPrompt', () => {
  it('renders nothing when there is no pending request', () => {
    const { container } = render(wrap(<McpApprovalPrompt />));
    expect(container).toBeEmptyDOMElement();
  });

  it('approves the pending request', async () => {
    const p = useMcpApprovalStore.getState().request({
      serverId: 's',
      serverName: 'GitHub',
      toolName: 'search',
      args: { q: 'x' },
      host: 'gh.example',
      firstUse: false,
    });
    render(wrap(<McpApprovalPrompt />));
    expect(screen.getByText(/wants to run/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await expect(p).resolves.toBe(true);
  });

  it('shows the host, the arguments, Approve, Deny and Always allow', () => {
    void call();
    render(wrap(<McpApprovalPrompt />));
    expect(screen.getByText(/api\.github\.example/)).toBeInTheDocument();
    expect(screen.getByText(/needle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^deny$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /always allow/i })).toBeInTheDocument();
    expect(screen.queryByText(/hasn't contacted this server yet/i)).toBeNull();
  });

  it('Always allow still sets autoRun on the row and approves', async () => {
    rows.push({ id: 's', name: 'GitHub', autoRun: false });
    const p = call();
    render(wrap(<McpApprovalPrompt />));
    await userEvent.click(screen.getByRole('button', { name: /always allow/i }));
    await expect(p).resolves.toBe(true);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 's', autoRun: true }));
  });

  it('carries the first-use wording when firstUse', () => {
    void call({ firstUse: true });
    render(wrap(<McpApprovalPrompt />));
    expect(screen.getByText(/This device hasn't contacted this server yet/)).toBeInTheDocument();
  });

  it('Deny resolves false', async () => {
    const p = call();
    render(wrap(<McpApprovalPrompt />));
    await userEvent.click(screen.getByRole('button', { name: /^deny$/i }));
    await expect(p).resolves.toBe(false);
  });

  it('asks "Use this server here?" for a first use, naming the host', async () => {
    const p = useMcpApprovalStore
      .getState()
      .requestFirstUse({ serverId: 's', serverName: 'GitHub', host: 'api.github.example' });
    render(wrap(<McpApprovalPrompt />));
    expect(screen.getByText('Use this server here?')).toBeInTheDocument();
    expect(screen.getByText(/api\.github\.example/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /always allow/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^not now$/i }));
    await expect(p).resolves.toBe(false);
  });

  it('approves a first use', async () => {
    const p = useMcpApprovalStore
      .getState()
      .requestFirstUse({ serverId: 's', serverName: 'GitHub', host: 'api.github.example' });
    render(wrap(<McpApprovalPrompt />));
    await userEvent.click(screen.getByRole('button', { name: /^use here$/i }));
    await expect(p).resolves.toBe(true);
  });
});
