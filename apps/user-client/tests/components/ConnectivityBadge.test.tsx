// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectivityBadge } from '../../src/components/ConnectivityBadge.js';

function linked(): void {
  useAccountLinkStore
    .getState()
    .setLinked({ base_url: 'https://s.example', issuer_label: 's.example', role: 'user' });
}

describe('ConnectivityBadge expanded framing (§11.2)', () => {
  beforeEach(() => {
    useAccountLinkStore.getState().setLocalOnly();
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
  });

  it('carries the paused-shared-edits framing when a linked user is offline', async () => {
    linked();
    useConnectivityStore.getState().setState({ kind: 'server_unreachable' });
    render(<ConnectivityBadge />);
    // Framing is behind the expanded/tapped state, not shown by default.
    expect(screen.queryByText(/shared edits are paused/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /connectivity/i }));
    expect(
      screen.getByText(
        /Your server isn't reachable, so shared edits are paused — nothing is lost/i,
      ),
    ).toBeInTheDocument();
  });

  it('tells the honest "server busy" story when throttled — never "unreachable"', async () => {
    linked();
    useConnectivityStore.getState().setState({ kind: 'server_rate_limited' });
    render(<ConnectivityBadge />);
    // The pill itself reads "Server busy", not "Server unreachable".
    expect(screen.getByRole('button', { name: /connectivity: server busy/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /connectivity/i }));
    expect(screen.getByText(/asked us to slow down after too many attempts/i)).toBeInTheDocument();
    // The misleading unreachable framing must not appear for a throttled server.
    expect(screen.queryByText(/isn't reachable/i)).not.toBeInTheDocument();
  });

  it('surfaces the concrete wait when the server gave a Retry-After', async () => {
    linked();
    // ~2 minutes out — the framing should name it, not just say "shortly".
    useConnectivityStore.getState().setState({
      kind: 'server_rate_limited',
      retryAt: Date.now() + 118_000,
    });
    render(<ConnectivityBadge />);
    await userEvent.click(screen.getByRole('button', { name: /connectivity/i }));
    // Concrete wait, and the self-healing framing is preserved (Laura SOFT).
    expect(screen.getByText(/resume on their own in about 2 minutes/i)).toBeInTheDocument();
  });

  it('shows the connected framing when linked and online', async () => {
    linked();
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
    render(<ConnectivityBadge />);
    await userEvent.click(screen.getByRole('button', { name: /connectivity/i }));
    expect(screen.getByText(/shared edits sync as you make them/i)).toBeInTheDocument();
  });

  it('shows the local-only framing when not linked', async () => {
    useAccountLinkStore.getState().setLocalOnly();
    render(<ConnectivityBadge />);
    await userEvent.click(screen.getByRole('button', { name: /connectivity/i }));
    expect(screen.getByText(/everything stays on this device/i)).toBeInTheDocument();
  });
});

describe('ConnectivityBadge minimal (in-chat) mode (SOFT-1)', () => {
  beforeEach(() => {
    useAccountLinkStore.getState().setLocalOnly();
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
  });

  it('stays silent while the weather is fine', () => {
    linked();
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
    render(<ConnectivityBadge minimal />);
    expect(screen.queryByRole('button', { name: /connectivity/i })).not.toBeInTheDocument();
  });

  it('surfaces a short offline cue with the paused framing when the server is unreachable', async () => {
    linked();
    useConnectivityStore.getState().setState({ kind: 'server_unreachable' });
    render(<ConnectivityBadge minimal />);
    // Short label on the tight reading surface, full explanation behind the tap.
    expect(screen.getByRole('button', { name: /connectivity: not synced/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /connectivity/i }));
    expect(screen.getByText(/shared edits are paused — nothing is lost/i)).toBeInTheDocument();
  });
});
