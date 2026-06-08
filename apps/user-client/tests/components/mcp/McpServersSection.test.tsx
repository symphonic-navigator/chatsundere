// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { McpServersSection } from '../../../src/components/mcp/McpServersSection.js';

vi.mock('../../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: [] }),
  useUpsertMcpServer: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteMcpServer: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
}));

function wrap(ui: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('McpServersSection', () => {
  it('shows an add button when there are no servers', () => {
    render(wrap(<McpServersSection />));
    expect(screen.getByRole('button', { name: /add mcp server/i })).toBeInTheDocument();
  });
});
