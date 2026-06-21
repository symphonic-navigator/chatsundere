// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../../src/components/Toast.js';
import { toastStore } from '../../src/state/toast.store.js';

afterEach(() => toastStore.clear());

describe('Toast action', () => {
  it('renders an action button and invokes its onClick', async () => {
    const onClick = vi.fn();
    render(<Toast />);
    toastStore.show({
      message: 'Memory rejected',
      tone: 'info',
      durationMs: 10_000,
      action: { label: 'Undo', onClick },
    });
    const btn = await screen.findByRole('button', { name: 'Undo' });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
