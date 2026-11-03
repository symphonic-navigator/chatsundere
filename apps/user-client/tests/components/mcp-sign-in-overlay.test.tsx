// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const m = vi.hoisted(() => ({
  check: vi.fn(),
  consent: vi.fn(async () => undefined),
  toast: vi.fn(),
  flowProps: null as null | Record<string, unknown>,
  servers: [] as Array<Record<string, unknown>>,
  class2Disabled: false,
}));
vi.mock('../../src/sync/gate.js', () => ({
  useClass2Gate: () => ({ disabled: m.class2Disabled, tooltip: null }),
}));

vi.mock('../../src/mcp/oauth/check-server.js', () => ({
  checkServer: (...a: unknown[]) => m.check(...a),
}));
vi.mock('../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: m.servers }),
  useUpsertMcpServer: () => ({ mutate: vi.fn() }),
  recordMcpConsent: (...a: unknown[]) => m.consent(...(a as [])),
}));
vi.mock('../../src/lib/server-gate.js', () => ({ useServerGate: () => ({ enabled: true }) }));
vi.mock('../../src/state/toast.store.js', () => ({
  toastStore: { show: (...a: unknown[]) => m.toast(...a) },
}));
vi.mock('../../src/components/mcp/OAuthSignInFlow.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  OAuthSignInFlow: (p: Record<string, unknown>) => {
    m.flowProps = p;
    return <div data-testid="flow" />;
  },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type MockInstance, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpApprovalPrompt } from '../../src/components/mcp/McpApprovalPrompt.js';
import { McpSignInOverlay } from '../../src/components/mcp/McpSignInOverlay.js';
import { useMcpApprovalStore } from '../../src/state/mcp-approval.store.js';
import { useMcpSignInOverlay } from '../../src/state/mcp-sign-in-overlay.store.js';

const DISCOVERY = { kind: 'oauth', resource: 'https://kumbu.example/mcp' };

function Chat() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <textarea aria-label="draft" defaultValue="" />
      <McpApprovalPrompt />
      <McpSignInOverlay />
    </QueryClientProvider>
  );
}

let windowOpen: MockInstance<typeof window.open>;
beforeEach(() => {
  m.check.mockReset();
  m.consent.mockClear();
  m.toast.mockClear();
  m.flowProps = null;
  m.class2Disabled = false;
  m.servers = [{ id: 's1', name: 'Kumbu', url: 'https://kumbu.example/mcp', allowDirect: false }];
  m.check.mockResolvedValue({ kind: 'sign-in', discovery: DISCOVERY });
  useMcpApprovalStore.setState({ pending: [] });
  useMcpSignInOverlay.setState({ target: null });
  windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  windowOpen.mockRestore();
});

describe('McpSignInOverlay', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<Chat />);
    expect(screen.queryByTestId('flow')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('runs discovery for the row URL and hands the flow its reconnect props', async () => {
    render(<Chat />);
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: ['write'] }));
    await screen.findByTestId('flow');
    expect(m.check).toHaveBeenCalledWith('https://kumbu.example/mcp', {
      hasProxy: true,
      allowDirect: false,
      exact: true,
    });
    expect(m.flowProps).toMatchObject({
      mode: 'overlay',
      serverId: 's1',
      draft: null,
      extraScopes: ['write'],
      discovery: DISCOVERY,
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('keeps a pending approval and the composer draft across open and close', async () => {
    render(<Chat />);
    const settled = vi.fn();
    void useMcpApprovalStore
      .getState()
      .request({
        serverId: 's1',
        serverName: 'Kumbu',
        toolName: 'search',
        args: {},
        host: 'kumbu.example',
        firstUse: false,
      })
      .then(settled);
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'half a thought' } });
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: [] }));
    await screen.findByTestId('flow');
    act(() => (m.flowProps?.onClose as () => void)());
    await waitFor(() => expect(screen.queryByTestId('flow')).toBeNull());
    expect(useMcpApprovalStore.getState().pending).toHaveLength(1);
    expect(settled).not.toHaveBeenCalled();
    expect((screen.getByLabelText('draft') as HTMLTextAreaElement).value).toBe('half a thought');
  });

  it('on success closes, records consent and toasts, without re-running anything', async () => {
    render(<Chat />);
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: [] }));
    await screen.findByTestId('flow');
    await act(async () => {
      await (m.flowProps?.onConnected as (r: unknown) => Promise<void>)({
        serverId: 's1',
        draft: null,
      });
    });
    expect(useMcpSignInOverlay.getState().target).toBeNull();
    expect(m.consent).toHaveBeenCalledWith('s1', 'https://kumbu.example/mcp');
    expect(m.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Connected. Ask again whenever you like',
        tone: 'success',
      }),
    );
    // A re-run would go through the approval queue again; nothing was queued.
    expect(useMcpApprovalStore.getState().pending).toHaveLength(0);
    expect(m.check).toHaveBeenCalledTimes(1);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('says so, and offers Back to chat, when the server no longer asks for a sign-in', async () => {
    m.check.mockResolvedValue({ kind: 'key', route: 'direct', endpoint: 'x' });
    render(<Chat />);
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: [] }));
    await screen.findByText(/no longer asks for a sign-in/);
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(useMcpSignInOverlay.getState().target).toBeNull();
  });

  it('offers Back to chat while still checking', async () => {
    m.check.mockReturnValue(new Promise(() => undefined));
    render(<Chat />);
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: [] }));
    expect(await screen.findByText('Checking Kumbu…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(useMcpSignInOverlay.getState().target).toBeNull();
  });

  it('refuses to start a sign-in while the backend is unreachable, without any check', async () => {
    m.class2Disabled = true;
    render(<Chat />);
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: [] }));
    expect(
      await screen.findByText(/waits until your Chatsundere server is reachable/),
    ).toBeTruthy();
    expect(m.check).not.toHaveBeenCalled();
    expect(screen.queryByTestId('flow')).toBeNull();
  });

  it('closes when the chat goes away, so it never reopens in the next chat', async () => {
    const { unmount } = render(<Chat />);
    act(() => useMcpSignInOverlay.getState().open({ serverId: 's1', extraScopes: [] }));
    await screen.findByTestId('flow');
    unmount();
    expect(useMcpSignInOverlay.getState().target).toBeNull();
  });
});
