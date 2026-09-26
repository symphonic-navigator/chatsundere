// SPDX-License-Identifier: AGPL-3.0-only
import { getProvider } from '@chatsundere/llm-unified';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CockpitUnavailable } from '../../../src/components/chat/CockpitUnavailable.js';
import type { UpdateCheckResult } from '../../../src/sw/app-update.store.js';
import { _resetAppUpdateForTests, useAppUpdateStore } from '../../../src/sw/app-update.store.js';
import { rememberReturnPath } from '../../../src/sw/post-update-return.js';

vi.mock('../../../src/sw/post-update-return.js', () => ({
  rememberReturnPath: vi.fn(),
}));

type Resolve = (r: UpdateCheckResult) => void;

let pending: Resolve[] = [];
let check: ReturnType<typeof vi.fn<() => Promise<UpdateCheckResult>>>;
let apply: ReturnType<typeof vi.fn<() => boolean>>;
let peek: ReturnType<typeof vi.fn<() => UpdateCheckResult>>;

beforeEach(() => {
  _resetAppUpdateForTests();
  pending = [];
  check = vi.fn(
    () =>
      new Promise<UpdateCheckResult>((resolve) => {
        pending.push(resolve);
      }),
  );
  apply = vi.fn(() => true);
  peek = vi.fn((): UpdateCheckResult => 'installing');
  useAppUpdateStore.getState().bind({ apply, check, peek });
  vi.mocked(rememberReturnPath).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

const modelUnknown = { kind: 'model-unknown', templateId: 'nano-gpt', modelId: 'x/y' } as const;

function mount(resolution: Parameters<typeof CockpitUnavailable>[0]['resolution']) {
  const onSetUpProvider = vi.fn();
  const onChooseModel = vi.fn();
  render(
    <CockpitUnavailable
      resolution={resolution}
      onSetUpProvider={onSetUpProvider}
      onChooseModel={onChooseModel}
    />,
  );
  return { onSetUpProvider, onChooseModel };
}

async function settle(result: UpdateCheckResult, index = 0): Promise<void> {
  await act(async () => {
    pending[index]?.(result);
  });
}

describe('CockpitUnavailable', () => {
  it('provider-unavailable names the provider and offers a focused set-up button', () => {
    const name = getProvider('nano-gpt')?.displayName ?? 'nano-gpt';
    const { onSetUpProvider } = mount({ kind: 'provider-unavailable', templateId: 'nano-gpt' });
    expect(screen.getByRole('status')).toHaveTextContent(`${name} isn't set up on this device.`);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const setUp = screen.getByRole('button', { name: `Set up ${name}` });
    expect(setUp).toHaveFocus();
    fireEvent.click(setUp);
    expect(onSetUpProvider).toHaveBeenCalledWith('nano-gpt');
    expect(check).not.toHaveBeenCalled();
  });

  it('model-unknown with an update ready focuses the region, not Update now', () => {
    useAppUpdateStore.getState().markUpdateReady();
    mount(modelUnknown);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('x/y needs a newer version of Chatsundere.');
    expect(region).toHaveTextContent(
      "Chatsundere will restart; you'll unlock once and come straight back here.",
    );
    expect(screen.getByText('x/y').tagName).toBe('CODE');
    const update = screen.getByRole('button', { name: 'Update now' });
    expect(update).not.toHaveFocus();
    expect(region).toHaveFocus();
    expect(check).not.toHaveBeenCalled();
    fireEvent.click(update);
    expect(rememberReturnPath).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rememberReturnPath).mock.invocationCallOrder[0]).toBeLessThan(
      apply.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('model-unknown checks on mount and walks checking → downloading → update ready', async () => {
    mount(modelUnknown);
    expect(screen.getByRole('status')).toHaveTextContent('Checking for a newer version…');
    expect(screen.queryByRole('button')).toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
    await settle('installing');
    expect(screen.getByRole('status')).toHaveTextContent(
      'A newer version of Chatsundere is downloading…',
    );
    expect(screen.queryByRole('button')).toBeNull();
    act(() => useAppUpdateStore.getState().markUpdateReady());
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("'none' shows the not-available row, with Check again re-running the check", async () => {
    const { onChooseModel } = mount(modelUnknown);
    await settle('none');
    expect(screen.getByRole('status')).toHaveTextContent(
      "x/y isn't available in this version of Chatsundere.",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose another model' }));
    expect(onChooseModel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Checking for a newer version…');
    await settle('none', 1);
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument();
    act(() => useAppUpdateStore.getState().markUpdateReady());
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
  });

  it('offline skips the check and disables Check again with a tooltip', () => {
    setOnline(false);
    mount(modelUnknown);
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      "x/y isn't available in this version of Chatsundere.",
    );
    const again = screen.getByRole('button', { name: 'Check again' });
    expect(again).toBeDisabled();
    expect(again).toHaveAttribute('title', "You're offline");
  });

  it('re-peeks the downloading row without restarting the install, falling back when it fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      mount(modelUnknown);
      await settle('installing');
      expect(check).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      // Still installing: a read-only peek, never another check (reg.update()).
      expect(peek).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent(
        'A newer version of Chatsundere is downloading…',
      );
      // The install failed: neither installing nor waiting any more.
      peek.mockReturnValue('none');
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(peek).toHaveBeenCalledTimes(2);
      expect(check).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent(
        "x/y isn't available in this version of Chatsundere.",
      );
      // The automatic fallback is not a user check: no "No newer version yet." line.
      expect(screen.queryByText('No newer version yet.')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(peek).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a user Check again that finds nothing refocuses Check again and says so quietly', async () => {
    mount(modelUnknown);
    await settle('none');
    expect(screen.queryByText('No newer version yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await settle('none', 1);
    const again = screen.getByRole('button', { name: 'Check again' });
    expect(again).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('No newer version yet.');
    // The next state change clears the line.
    fireEvent.click(again);
    expect(screen.queryByText('No newer version yet.')).toBeNull();
    await settle('installing', 2);
    expect(screen.queryByText('No newer version yet.')).toBeNull();
  });

  it('the mount-time check finding nothing shows no "No newer version yet." line', async () => {
    mount(modelUnknown);
    await settle('none');
    expect(screen.queryByText('No newer version yet.')).toBeNull();
  });

  it('enables Check again live when connectivity returns', () => {
    setOnline(false);
    mount(modelUnknown);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled();
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    const again = screen.getByRole('button', { name: 'Check again' });
    expect(again).toBeEnabled();
    expect(again).not.toHaveAttribute('title');
  });

  it('an empty modelId asks for a model and never checks', async () => {
    const { onChooseModel } = mount({ kind: 'model-unknown', templateId: 'nano-gpt', modelId: '' });
    expect(screen.getByRole('status')).toHaveTextContent('This persona has no model selected.');
    const choose = screen.getByRole('button', { name: 'Choose a model' });
    expect(choose).toHaveFocus();
    fireEvent.click(choose);
    expect(onChooseModel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(check).not.toHaveBeenCalled());
  });
});
