// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PillRow } from '../../src/boot/client-data-db.js';
import { Pill } from '../../src/components/chat/Pill.js';
import { useMcpSignInOverlay } from '../../src/state/mcp-sign-in-overlay.store.js';

const grants = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('../../src/data/mcp-oauth-grants.js', () => ({
  useMcpOAuthGrants: () => ({ data: grants.rows }),
}));
const gate = vi.hoisted(() => ({ disabled: false }));
vi.mock('../../src/sync/gate.js', () => ({
  useClass2Gate: () => ({ disabled: gate.disabled, tooltip: null }),
}));

type Auth = { variant: 'dead' | 'held' | 'waiting' | 'scope'; scope?: string };

function pill(auth: Auth | null, over: Partial<PillRow> = {}): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'failed',
    payload: {
      name: 'kumbu__search',
      argumentsJson: '{}',
      error: 'Kumbu is unavailable.',
      ...(auth ? { mcpAuth: { serverId: 's1', serverName: 'Kumbu', ...auth } } : {}),
    },
    createdAt: 0,
    ...over,
  };
}

function show(row: PillRow) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Pill row={row} />
    </QueryClientProvider>,
  );
}

let open: ReturnType<typeof vi.fn>;
let windowOpen: MockInstance<typeof window.open>;
beforeEach(() => {
  grants.rows = [{ id: 's1', tokens: null, scope: null }];
  gate.disabled = false;
  open = vi.fn();
  useMcpSignInOverlay.setState({ target: null, open: open as never });
  windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  windowOpen.mockRestore();
});

describe('McpAuthNotice on a tool pill', () => {
  it('dead: says the sign-in ended and offers Sign in again', () => {
    show(pill({ variant: 'dead' }));
    expect(screen.getByText('⚠ Kumbu: sign-in ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
  });

  it('waiting: says access cannot be renewed and has no button', () => {
    show(pill({ variant: 'waiting' }));
    expect(screen.getByText("○ Kumbu: can't renew access right now")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in|grant/i })).not.toBeInTheDocument();
  });

  it('scope: says more access is needed and offers Grant access', () => {
    show(pill({ variant: 'scope', scope: 'read write' }));
    expect(screen.getByText('⚠ Kumbu: needs more access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument();
  });

  it('Sign in again only opens the overlay and never calls window.open itself', () => {
    show(pill({ variant: 'dead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(open).toHaveBeenCalledWith({ serverId: 's1', extraScopes: [] });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('Grant access passes the challenged scopes as extraScopes', () => {
    show(pill({ variant: 'scope', scope: 'read  write' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(open).toHaveBeenCalledWith({ serverId: 's1', extraScopes: ['read', 'write'] });
  });

  it('a dead notice whose grant has tokens again offers no action', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 } }];
    show(pill({ variant: 'dead' }));
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
    expect(screen.queryByText('⚠ Kumbu: sign-in ended')).not.toBeInTheDocument();
    expect(screen.getByText('● Kumbu: connected again')).toBeInTheDocument();
  });

  it('a dead notice whose grant holds a pending pair also reads as connected again', () => {
    grants.rows = [{ id: 's1', tokens: null, pendingTokens: { v: 1 } }];
    show(pill({ variant: 'dead' }));
    expect(screen.getByText('● Kumbu: connected again')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });

  it('a scope notice whose scopes the live grant now holds says access granted, no action', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 }, scope: 'read write offline_access' }];
    show(pill({ variant: 'scope', scope: 'write read' }));
    expect(screen.getByText('● Kumbu: access granted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grant access' })).not.toBeInTheDocument();
  });

  it('a scope notice still offers Grant access while a scope is missing from the grant', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 }, scope: 'read' }];
    show(pill({ variant: 'scope', scope: 'read write' }));
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument();
  });

  it('a scope notice without tokens on the grant still offers Grant access', () => {
    grants.rows = [{ id: 's1', tokens: null, scope: 'read write' }];
    show(pill({ variant: 'scope', scope: 'read write' }));
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument();
  });

  it('disables Sign in again and Grant access with the reason while the backend is unreachable', () => {
    gate.disabled = true;
    show(pill({ variant: 'dead' }));
    const button = screen.getByRole('button', { name: 'Sign in again' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(
        "Signing in again waits until your Chatsundere server is reachable, so it can't clash with your other devices.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(open).not.toHaveBeenCalled();
    cleanup();
    show(pill({ variant: 'scope', scope: 'write' }));
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeDisabled();
  });

  it('held: with a held grant says paused here and Sign in again opens the overlay', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 }, heldGeneration: 4 }];
    show(pill({ variant: 'held' }));
    expect(screen.getByText('⚠ Kumbu: sign-in paused on this device')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(open).toHaveBeenCalledWith({ serverId: 's1', extraScopes: [] });
  });

  it('held: a held grant whose only access is a pending pair still reads as paused', () => {
    grants.rows = [{ id: 's1', tokens: null, pendingTokens: { v: 1 }, heldGeneration: 4 }];
    show(pill({ variant: 'held' }));
    expect(screen.getByText('⚠ Kumbu: sign-in paused on this device')).toBeInTheDocument();
    expect(screen.queryByText('● Kumbu: in use')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
  });

  it('held: a held grant with a new sign-in pending says in use and offers no action', () => {
    grants.rows = [
      {
        id: 's1',
        tokens: { v: 1 },
        pendingTokens: { v: 1 },
        pendingNewFamily: true,
        heldGeneration: 4,
      },
    ];
    show(pill({ variant: 'held' }));
    expect(screen.getByText('● Kumbu: in use')).toBeInTheDocument();
    expect(screen.queryByText('⚠ Kumbu: sign-in paused on this device')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in|grant/i })).not.toBeInTheDocument();
  });

  it('held: disables Sign in again with the reason while the backend is unreachable', () => {
    gate.disabled = true;
    grants.rows = [{ id: 's1', tokens: { v: 1 }, heldGeneration: 4 }];
    show(pill({ variant: 'held' }));
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeDisabled();
  });

  it('held: with a live grant here says in use and offers no action', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 }, heldGeneration: null }];
    show(pill({ variant: 'held' }));
    expect(screen.getByText('● Kumbu: in use')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign in|grant/i })).not.toBeInTheDocument();
  });

  it.each([
    ['a dead grant', [{ id: 's1', tokens: null }]],
    ['no grant', []],
  ])('held: with %s reads as ended and offers Sign in again', (_label, rows) => {
    grants.rows = rows;
    show(pill({ variant: 'held' }));
    expect(screen.getByText('⚠ Kumbu: sign-in ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
  });

  it('a dead notice whose grant is held never reads as connected again', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 }, heldGeneration: 4 }];
    show(pill({ variant: 'dead' }));
    expect(screen.queryByText('● Kumbu: connected again')).not.toBeInTheDocument();
    expect(screen.getByText('⚠ Kumbu: sign-in ended')).toBeInTheDocument();
  });

  it('a scope notice whose grant is held never reads as access granted', () => {
    grants.rows = [{ id: 's1', tokens: { v: 1 }, scope: 'read write', heldGeneration: 4 }];
    show(pill({ variant: 'scope', scope: 'read write' }));
    expect(screen.queryByText('● Kumbu: access granted')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument();
  });

  it('an old pill without mcpAuth renders no notice', () => {
    show(pill(null));
    expect(screen.queryByText(/sign-in ended|needs more access|renew access/)).toBeNull();
  });

  it('shows Renewing access… on a running pill in the renewing phase', () => {
    const row = pill(null, { status: 'pending' });
    (row.payload as Record<string, unknown>).phase = 'renewing';
    show(row);
    expect(screen.getByText('Renewing access…')).toBeInTheDocument();
  });

  it('does not show Renewing access… once the pill has finished', () => {
    const row = pill(null, { status: 'completed' });
    (row.payload as Record<string, unknown>).phase = 'renewing';
    show(row);
    expect(screen.queryByText('Renewing access…')).toBeNull();
  });
});
