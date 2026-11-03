// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(async () => undefined),
  hold: vi.fn(),
  listen: vi.fn(),
  load: vi.fn(),
  check: vi.fn(),
}));

vi.mock('../../src/mcp/oauth/sign-in.js', () => ({
  prepareSignIn: (...a: unknown[]) => m.prepare(...a),
  completeSignIn: (...a: unknown[]) => m.complete(...a),
  cancelSignIn: (...a: unknown[]) => m.cancel(...(a as [])),
  holdPendingSignIn: (...a: unknown[]) => m.hold(...a),
  listenForCallback: (...a: unknown[]) => m.listen(...a),
}));
vi.mock('../../src/mcp/oauth/sign-in-session.js', () => ({
  createSignInDeps: async () => ({ fake: true }),
  loadPendingSignIn: (...a: unknown[]) => m.load(...a),
}));
vi.mock('../../src/mcp/oauth/check-server.js', () => ({
  checkServer: (...a: unknown[]) => m.check(...a),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type MockInstance, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OAuthSignInFlow,
  type OAuthSignInFlowProps,
} from '../../src/components/mcp/OAuthSignInFlow.js';
import { encodeCallbackPayload } from '../../src/mcp/oauth/callback-payload.js';
import type { OAuthDiscovery } from '../../src/mcp/oauth/discovery.js';
import type { ServerDraft } from '../../src/mcp/oauth/sign-in.js';
import { OAuthError } from '../../src/mcp/oauth/url.js';

const AUTH_URL = 'https://auth.kumbu.example/authorize?state=s1';
const DISCOVERY: OAuthDiscovery = {
  kind: 'oauth',
  resource: 'https://kumbu.example/mcp',
  issuer: 'https://auth.kumbu.example',
  resourceName: 'Kumbu',
  authorizationEndpoint: 'https://auth.kumbu.example/authorize',
  tokenEndpoint: 'https://auth.kumbu.example/token',
  registrationEndpoint: null,
  revocationEndpoint: null,
  cimdSupported: true,
  issParameterSupported: false,
  scope: null,
};
const DRAFT: ServerDraft = {
  name: 'Kumbu',
  prefix: 'kumbu',
  url: 'https://kumbu.example/mcp',
  onByDefault: true,
  autoRun: false,
  allowDirect: false,
  routing: 'proxy',
  resolvedEndpoint: 'https://kumbu.example/mcp',
};

type Timer = { fn: () => void; ms: number };
let timers: Timer[];
let clockNow: number;
let onConnected: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let onUseKey: ReturnType<typeof vi.fn>;
let openSpy: MockInstance<typeof window.open>;

function renderFlow(over: Partial<OAuthSignInFlowProps> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <OAuthSignInFlow
        discovery={DISCOVERY}
        draft={DRAFT}
        mode="page"
        onConnected={onConnected}
        onClose={onClose}
        onUseKey={onUseKey}
        timers={{
          now: () => clockNow,
          schedule: (fn, ms) => {
            const t = { fn, ms };
            timers.push(t);
            return () => {
              timers = timers.filter((x) => x !== t);
            };
          },
        }}
        {...over}
      />
    </QueryClientProvider>,
  );
}

async function toWaiting() {
  renderFlow();
  const cont = await screen.findByRole('button', { name: 'Continue to sign-in' });
  await waitFor(() => expect(cont).toBeEnabled());
  fireEvent.click(cont);
  await screen.findByText('Waiting for sign-in…');
}

const code = (state = 's1') => encodeCallbackPayload({ code: 'fake-code', state });

describe('OAuthSignInFlow', () => {
  beforeEach(() => {
    cleanup();
    for (const f of Object.values(m)) f.mockReset();
    m.cancel.mockResolvedValue(undefined);
    m.prepare.mockResolvedValue({ state: 's1', authorizationUrl: AUTH_URL });
    m.listen.mockReturnValue(() => undefined);
    timers = [];
    clockNow = 1_000_000;
    onConnected = vi.fn();
    onClose = vi.fn();
    onUseKey = vi.fn();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => {
    openSpy.mockRestore();
  });

  describe('confirmation', () => {
    it('names the server and the sign-in host, says all devices, and warns to trust', async () => {
      renderFlow();
      expect(screen.getByRole('heading', { name: /Sign in to kumbu\.example/ })).toBeTruthy();
      expect(screen.getByText(/You'll sign in at auth\.kumbu\.example/)).toBeTruthy();
      expect(screen.getByText(/all your devices/)).toBeTruthy();
      expect(screen.getByText(/Only connect servers you trust/)).toBeTruthy();
    });

    it('keeps Continue disabled until the sign-in is prepared', async () => {
      let resolve: (v: unknown) => void = () => undefined;
      m.prepare.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      renderFlow();
      const cont = screen.getByRole('button', { name: 'Continue to sign-in' });
      expect(cont).toBeDisabled();
      await act(async () => resolve({ state: 's1', authorizationUrl: AUTH_URL }));
      expect(cont).toBeEnabled();
      expect(m.prepare.mock.calls[0]?.[1]).toMatchObject({ draft: DRAFT });
    });

    it('opens the window synchronously inside the Continue click', async () => {
      renderFlow();
      const cont = await screen.findByRole('button', { name: 'Continue to sign-in' });
      await waitFor(() => expect(cont).toBeEnabled());
      fireEvent.click(cont);
      expect(openSpy).toHaveBeenCalledWith(AUTH_URL, '_blank', 'noopener');
    });

    it('passes a reconnect server id and extra scopes on to the preparation', async () => {
      renderFlow({ serverId: 'srv-1', draft: null, extraScopes: ['kumbu:write'] });
      await waitFor(() => expect(m.prepare).toHaveBeenCalled());
      expect(m.prepare.mock.calls[0]?.[1]).toEqual({
        serverId: 'srv-1',
        draft: null,
        extraScopes: ['kumbu:write'],
      });
    });

    it('maps a missing client identity to approved-apps copy with Use a key instead', async () => {
      m.prepare.mockRejectedValue(
        new OAuthError('no-client-identity', 'This server only accepts approved apps.'),
      );
      renderFlow();
      expect(await screen.findByText('This server only accepts approved apps')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Use a key instead' }));
      expect(onUseKey).toHaveBeenCalled();
      expect(screen.queryByText(/no-client-identity/)).toBeNull();
    });

    it('treats a refused registration the same way', async () => {
      m.prepare.mockRejectedValue(new OAuthError('registration-refused', 'refused'));
      renderFlow();
      expect(await screen.findByText('This server only accepts approved apps')).toBeTruthy();
    });

    it('asks to unlock when there is no key', async () => {
      m.prepare.mockRejectedValue(new OAuthError('locked', 'Unlock the app to sign in.'));
      renderFlow();
      expect(await screen.findByText(/Unlock Chatsundere to sign in/)).toBeTruthy();
    });

    it('drops a prepared but never opened sign-in when leaving', async () => {
      const { unmount } = renderFlow();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Continue to sign-in' })).toBeEnabled(),
      );
      unmount();
      expect(m.cancel).toHaveBeenCalledWith('s1');
    });
  });

  describe('waiting screen', () => {
    it('shows the four elements', async () => {
      await toWaiting();
      expect(screen.getByText('Nothing opened?')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open sign-in again' })).toBeTruthy();
      expect(screen.getByLabelText('Sign-in showed you a code?')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
      expect(screen.getByText(/Some servers only accept approved apps/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Use a key instead' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });

    it('reopens the same sign-in without preparing a new one', async () => {
      await toWaiting();
      fireEvent.click(screen.getByRole('button', { name: 'Open sign-in again' }));
      expect(openSpy).toHaveBeenCalledTimes(2);
      expect(openSpy.mock.calls[1]).toEqual([AUTH_URL, '_blank', 'noopener']);
      expect(m.prepare).toHaveBeenCalledTimes(1);
    });

    it('finishes by itself on a valid pasted code, without Finish', async () => {
      m.complete.mockResolvedValue({ ok: true, serverId: 'new-id', draft: DRAFT, grant: {} });
      await toWaiting();
      fireEvent.change(screen.getByLabelText('Sign-in showed you a code?'), {
        target: { value: code() },
      });
      await waitFor(() =>
        expect(onConnected).toHaveBeenCalledWith({ serverId: 'new-id', draft: DRAFT }),
      );
      expect(m.complete.mock.calls[0]?.[0]).toEqual({ code: 'fake-code', state: 's1' });
    });

    it('refuses a code from another sign-in', async () => {
      await toWaiting();
      fireEvent.change(screen.getByLabelText('Sign-in showed you a code?'), {
        target: { value: code('someone-else') },
      });
      expect(await screen.findByText("This code doesn't belong to this sign-in.")).toBeTruthy();
      expect(m.complete).not.toHaveBeenCalled();
    });

    it('refuses a malformed code on Finish', async () => {
      await toWaiting();
      fireEvent.change(screen.getByLabelText('Sign-in showed you a code?'), {
        target: { value: 'csm1.nonsense' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
      expect(await screen.findByText("This code doesn't belong to this sign-in.")).toBeTruthy();
      expect(m.complete).not.toHaveBeenCalled();
    });

    it('finishes from the callback page on the channel', async () => {
      m.complete.mockResolvedValue({ ok: true, serverId: 'new-id', draft: DRAFT, grant: {} });
      await toWaiting();
      const onResult = m.listen.mock.calls.at(-1)?.[0] as (p: unknown) => void;
      await act(async () => onResult({ code: 'fake-code', state: 's1' }));
      await waitFor(() => expect(onConnected).toHaveBeenCalled());
    });

    it('Cancel deletes the pending sign-in', async () => {
      await toWaiting();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(m.cancel).toHaveBeenCalledWith('s1'));
      expect(onClose).toHaveBeenCalled();
    });

    it('leaving keeps the pending sign-in', async () => {
      await toWaiting();
      cleanup();
      expect(m.cancel).not.toHaveBeenCalled();
    });

    it('moves by itself to Sign-in expired after 10 minutes, with Start again', async () => {
      await toWaiting();
      const timer = timers.at(-1);
      expect(timer?.ms).toBe(10 * 60_000);
      clockNow += 10 * 60_000;
      await act(async () => timer?.fn());
      expect(screen.getByRole('heading', { name: 'Sign-in expired' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
      await waitFor(() => expect(m.prepare).toHaveBeenCalledTimes(2));
    });
  });

  describe('when completion does not succeed', () => {
    const paste = async () => {
      await toWaiting();
      fireEvent.change(screen.getByLabelText('Sign-in showed you a code?'), {
        target: { value: code() },
      });
    };

    it('says plainly that the exchange failed and offers Start again', async () => {
      m.complete.mockResolvedValue({ ok: false, reason: 'exchange-failed' });
      await paste();
      expect(await screen.findByRole('heading', { name: "Signing in didn't finish" })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy();
      expect(screen.queryByText(/exchange-failed/)).toBeNull();
    });

    it('reports a cancelled sign-in', async () => {
      m.complete.mockResolvedValue({ ok: false, reason: 'cancelled' });
      await paste();
      expect(await screen.findByRole('heading', { name: 'Sign-in was cancelled' })).toBeTruthy();
    });

    it('reports an already finished sign-in and still lets it be saved', async () => {
      m.complete.mockResolvedValue({
        ok: false,
        reason: 'already-connected',
        serverId: 'new-id',
        draft: DRAFT,
      });
      await paste();
      expect(await screen.findByRole('heading', { name: 'Already connected' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onConnected).toHaveBeenCalledWith({ serverId: 'new-id', draft: DRAFT });
    });

    it('refuses an unknown state with the belongs-to copy', async () => {
      m.complete.mockResolvedValue({ ok: false, reason: 'unknown-state' });
      await paste();
      expect(await screen.findByText("This code doesn't belong to this sign-in.")).toBeTruthy();
    });

    it('asks to unlock when locked', async () => {
      m.complete.mockResolvedValue({ ok: false, reason: 'locked' });
      await paste();
      expect(await screen.findByText(/Unlock Chatsundere to finish signing in/)).toBeTruthy();
    });
  });

  describe('resuming a pending sign-in', () => {
    it('opens straight on the waiting screen and reuses the stored sign-in', async () => {
      m.load.mockResolvedValue({
        state: 's9',
        serverId: 'new-9',
        isNewServer: true,
        draft: DRAFT,
        resource: DRAFT.url,
        createdAt: clockNow - 60_000,
        authorizationUrl: 'https://auth.kumbu.example/authorize?state=s9',
      });
      renderFlow({ discovery: undefined, draft: null, state: 's9' });
      expect(await screen.findByText('Waiting for sign-in…')).toBeTruthy();
      expect(m.hold).toHaveBeenCalledWith('s9');
      expect(timers.at(-1)?.ms).toBe(9 * 60_000);
      fireEvent.click(screen.getByRole('button', { name: 'Open sign-in again' }));
      expect(openSpy).toHaveBeenCalledWith(
        'https://auth.kumbu.example/authorize?state=s9',
        '_blank',
        'noopener',
      );
      expect(m.prepare).not.toHaveBeenCalled();
    });

    it('says when the pending sign-in is gone', async () => {
      m.load.mockResolvedValue(null);
      renderFlow({ discovery: undefined, draft: null, state: 'gone' });
      expect(await screen.findByRole('heading', { name: 'Sign-in expired' })).toBeTruthy();
    });
  });

  it('renders as a dialog in overlay mode', async () => {
    renderFlow({ mode: 'overlay' });
    expect(screen.getByRole('dialog', { name: /Sign in to kumbu\.example/ })).toBeTruthy();
  });

  describe('fix round 1', () => {
    it('offers no key switch on a resumed reconnect, with the reason', async () => {
      m.load.mockResolvedValue({
        state: 's9',
        serverId: 'existing-1',
        isNewServer: false,
        draft: null,
        resource: DRAFT.url,
        issuer: 'https://auth.kumbu.example',
        createdAt: clockNow - 60_000,
        authorizationUrl: AUTH_URL,
      });
      renderFlow({ discovery: undefined, draft: null, state: 's9' });
      await screen.findByText('Waiting for sign-in…');
      expect(screen.getByRole('button', { name: 'Use a key instead' })).toBeDisabled();
      expect(
        screen.getByText('To use a key, remove this server and add it again with the key.'),
      ).toBeTruthy();
      expect(onUseKey).not.toHaveBeenCalled();
    });

    it('a failing save after a good exchange is not a failed sign-in', async () => {
      m.complete.mockResolvedValue({ ok: true, serverId: 'new-id', draft: DRAFT, grant: {} });
      onConnected.mockRejectedValue(new Error('offline'));
      await toWaiting();
      fireEvent.change(screen.getByLabelText('Sign-in showed you a code?'), {
        target: { value: code() },
      });
      expect(await screen.findByText('Connected. Saving will finish shortly.')).toBeTruthy();
      expect(screen.queryByText("Signing in didn't finish")).toBeNull();
    });

    it('moves focus into the overlay, closes on Escape, and gives focus back', async () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      const { unmount } = renderFlow({ mode: 'overlay' });
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
      unmount();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });
  });
});
