// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { addedToast, connectedToast } from '../../../src/components/mcp/sign-in-copy.js';

describe('the toasts on the chat after a server from it was saved', () => {
  it('promise the tools on the next message when the server is on by default', () => {
    expect(connectedToast('Kumbu', true)).toBe(
      'Kumbu is connected. Its tools are ready on your next message.',
    );
    expect(addedToast('Kumbu', true)).toBe(
      'Kumbu is added. Its tools are ready on your next message.',
    );
  });

  it('promise nothing more when it is not', () => {
    expect(connectedToast('Kumbu', false)).toBe('Kumbu is connected.');
    expect(addedToast('Kumbu', false)).toBe('Kumbu is added.');
  });
});
