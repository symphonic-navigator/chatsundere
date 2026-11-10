// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpOAuthGrantRow } from '../../src/boot/client-data-db.js';
import { OAuthConnectionPanel } from '../../src/components/mcp/OAuthConnectionPanel.js';
import { SIGN_IN_WAITS_FOR_BACKEND } from '../../src/components/mcp/sign-in-copy.js';

const PAUSED =
  'This device received a copy of this sign-in that is older than the one it already had, so it has paused the sign-in to keep it safe. Nothing has been removed. Sign in again to carry on, or wait: if your other devices catch up, it carries on by itself.';

const GRANT = {
  id: 'o1',
  resource: 'https://kumbu.example/mcp',
  issuer: 'https://auth.kumbu.example',
  tokens: { v: 1 },
  pendingTokens: null,
  heldGeneration: null,
  claim: null,
} as unknown as McpOAuthGrantRow;

function show(grant: McpOAuthGrantRow | undefined, over: { backendUnreachable?: boolean } = {}) {
  const onSignInAgain = vi.fn();
  render(
    <OAuthConnectionPanel
      status="status"
      grant={grant}
      signingIn={false}
      backendUnreachable={over.backendUnreachable ?? false}
      starting={false}
      startError={null}
      onSignInAgain={onSignInAgain}
      onReturnToSignIn={() => {}}
    />,
  );
  return onSignInAgain;
}

afterEach(cleanup);

describe('OAuthConnectionPanel', () => {
  it('explains a held grant and offers an enabled Sign in again', () => {
    const onSignInAgain = show({ ...GRANT, heldGeneration: 4 });
    expect(screen.getByText(PAUSED)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Sign in again' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSignInAgain).toHaveBeenCalledOnce();
  });

  it('disables Sign in again on a held grant with the reason while the backend is unreachable', () => {
    show({ ...GRANT, heldGeneration: 4 }, { backendUnreachable: true });
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeDisabled();
    expect(screen.getByText(SIGN_IN_WAITS_FOR_BACKEND)).toBeInTheDocument();
  });

  it('a live grant shows neither the paused paragraph nor Sign in again', () => {
    show(GRANT);
    expect(screen.queryByText(PAUSED)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });

  it('a grant not yet arrived offers no Sign in again', () => {
    show(undefined);
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });
});
