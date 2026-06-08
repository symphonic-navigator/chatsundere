// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { McpOverrideSection } from '../../../src/components/persona-editor/McpOverrideSection.js';

const servers = [
  { id: 's1', name: 'GitHub', onByDefault: true, enabled: true },
  { id: 's2', name: 'Files', onByDefault: false, enabled: true },
];

describe('McpOverrideSection', () => {
  it('"Off" on a default-on server records an off override', async () => {
    const onChange = vi.fn();
    render(<McpOverrideSection servers={servers} overrides={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'GitHub off' }));
    expect(onChange).toHaveBeenCalledWith({ s1: 'off' });
  });

  it('"Default" clears an existing override', async () => {
    const onChange = vi.fn();
    render(<McpOverrideSection servers={servers} overrides={{ s1: 'off' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'GitHub default' }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
