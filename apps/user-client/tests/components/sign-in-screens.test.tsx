// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInConfirm } from '../../src/components/mcp/SignInScreens.js';

const LINE =
  "This sign-in service doesn't accept requests from browsers, so its details came through your Chatsundere server. Check that the sign-in address above is the one you expect.";

function renderConfirm(viaProxy: boolean) {
  return render(
    <SignInConfirm
      serverHost="kumbu.example"
      authHost="auth.kumbu.example"
      viaProxy={viaProxy}
      linked={false}
      ready
      onContinue={vi.fn()}
      onNotNow={vi.fn()}
    />,
  );
}

describe('SignInConfirm', () => {
  afterEach(cleanup);

  it('says the details came through the server, right after the sign-in-at paragraph', () => {
    renderConfirm(true);
    const line = screen.getByText(LINE);
    const signInAt = screen.getByText(/You'll sign in at/);
    expect(signInAt.nextElementSibling).toBe(line);
    expect(screen.getByRole('button', { name: 'Continue to sign-in' })).toBeEnabled();
  });

  it('omits the line when the details came direct', () => {
    renderConfirm(false);
    expect(screen.queryByText(LINE)).toBeNull();
  });
});
