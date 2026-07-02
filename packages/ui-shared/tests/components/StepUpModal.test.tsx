// SPDX-License-Identifier: LGPL-3.0-only
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StepUpModal, type StepUpModalCopy } from '../../src/components/StepUpModal.js';
import { requestStepUp, useStepUpStore } from '../../src/state/step-up.store.js';

// jsdom does not implement the native <dialog> showModal / close methods.
// Stub them so StepUpModal's useEffect can run without throwing (mirrors
// tests/components/confirm-typed.test.tsx).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const COPY: StepUpModalCopy = {
  title: 'Confirm it’s you',
  bodyBoth: 'A quick re-check keeps your account safe.',
  bodyPassphraseOnly: 'Re-enter your passphrase to continue.',
  usePasskeyCta: 'Use passkey',
  usePassphraseCta: 'Use passphrase instead',
  passphraseLabel: 'Passphrase',
  confirmCta: 'Confirm',
  cancelCta: 'Cancel',
  passkeyFailed: 'Couldn’t verify with passkey. Try your passphrase.',
  wrongPassphrase: 'Wrong passphrase. Try again.',
  genericError: 'Something went wrong. Please try again.',
  busy: 'Checking…',
};

describe('StepUpModal', () => {
  beforeEach(() => useStepUpStore.setState({ pending: null }));
  afterEach(cleanup);

  it('renders nothing without a pending request', () => {
    render(<StepUpModal passkeyAvailable={false} onPassphrase={vi.fn()} copy={COPY} />);
    expect(screen.queryByText(COPY.title)).toBeNull();
  });

  it('passphrase-only: confirms via onPassphrase and resolves the gate true', async () => {
    const onPassphrase = vi.fn().mockResolvedValue('confirmed');
    render(<StepUpModal passkeyAvailable={false} onPassphrase={onPassphrase} copy={COPY} />);
    const gate = requestStepUp('t1');
    await screen.findByText(COPY.bodyPassphraseOnly);
    await userEvent.type(screen.getByLabelText(COPY.passphraseLabel), 'hunter2 correct horse');
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmCta }));
    await expect(gate).resolves.toBe(true);
  });

  it('falls through silently from passkey to passphrase on uv_required', async () => {
    const onPasskey = vi.fn().mockResolvedValue('uv_required');
    render(
      <StepUpModal passkeyAvailable onPasskey={onPasskey} onPassphrase={vi.fn()} copy={COPY} />,
    );
    requestStepUp('t1');
    await userEvent.click(await screen.findByRole('button', { name: COPY.usePasskeyCta }));
    // Silent switch: passphrase view, no error notice (spec §7.2).
    await screen.findByLabelText(COPY.passphraseLabel);
    expect(screen.queryByText(COPY.passkeyFailed)).toBeNull();
  });

  it('shows wrongPassphrase and stays open on a wrong passphrase', async () => {
    const onPassphrase = vi.fn().mockResolvedValue('wrong_passphrase');
    render(<StepUpModal passkeyAvailable={false} onPassphrase={onPassphrase} copy={COPY} />);
    const gate = requestStepUp('t1');
    await userEvent.type(await screen.findByLabelText(COPY.passphraseLabel), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: COPY.confirmCta }));
    await screen.findByText(COPY.wrongPassphrase);
    // Gate is still pending.
    let settled = false;
    void gate.then(() => {
      settled = true;
    });
    await waitFor(() => expect(settled).toBe(false));
  });

  it('cancel resolves the gate false', async () => {
    render(<StepUpModal passkeyAvailable={false} onPassphrase={vi.fn()} copy={COPY} />);
    // The modal mounts in the choice view, then the open-effect swaps it to the
    // passphrase view. Wrap the external-store update in act() so React commits
    // that swap before we grab the cancel button — otherwise findByRole holds a
    // detached node and the delegated onClick never fires. This is an
    // act-boundary artefact of the jsdom <dialog> harness, not a component bug.
    let gate: Promise<boolean> = Promise.resolve(false);
    act(() => {
      gate = requestStepUp('t1');
    });
    await userEvent.click(await screen.findByRole('button', { name: COPY.cancelCta }));
    await expect(gate).resolves.toBe(false);
  });
});
