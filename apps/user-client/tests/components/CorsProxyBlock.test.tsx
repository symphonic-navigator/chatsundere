// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CORS_PROXY_URL } from '../../src/lib/cors-proxy.js';

const updateMock = vi.fn(async () => {});
let proxyState: { url: string; sharedKey: unknown } | null = null;
let providerRows: Array<{ templateId: string; enabled: boolean }> = [];

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: proxyState } }),
  useUpdateSettings: () => ({ mutateAsync: updateMock }),
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
// sealSecret returns an EncryptedBlob ({ version, ciphertext, nonce }) — the
// real shape from lib/secrets.ts, not a { ct, iv } placeholder.
vi.mock('../../src/lib/secrets.js', () => ({
  sealSecret: vi.fn(async () => ({
    version: 1 as const,
    ciphertext: new Uint8Array([1]),
    nonce: new Uint8Array([2]),
  })),
}));
// useSessionStore exposes `mk` (the in-memory MasterKey). A non-null sentinel
// is sufficient for the component's `if (!mk)` guard.
vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (sel: (s: { mk: unknown }) => unknown) => sel({ mk: { sentinel: true } }),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) => ({
    corsHint: id === 'wafer' ? 'requires-proxy' : 'direct',
    displayName: id,
  }),
}));

import { CorsProxyBlock } from '../../src/components/CorsProxyBlock.js';

describe('CorsProxyBlock', () => {
  it('shows the transitional caption', () => {
    proxyState = null;
    providerRows = [];
    render(<CorsProxyBlock />);
    expect(screen.getByText(/server connection at beta/i)).toBeInTheDocument();
  });

  it('shows "no key set" when none configured', () => {
    proxyState = null;
    providerRows = [];
    render(<CorsProxyBlock />);
    expect(screen.getByText(/no key set/i)).toBeInTheDocument();
  });

  it('shows the fixed proxy endpoint read-only (no URL input)', () => {
    proxyState = null;
    providerRows = [];
    render(<CorsProxyBlock />);
    expect(screen.getByText(CORS_PROXY_URL)).toBeInTheDocument();
    expect(screen.queryByLabelText(/proxy url/i)).not.toBeInTheDocument();
  });

  it('saves the key against the fixed proxy URL', async () => {
    proxyState = null;
    providerRows = [];
    updateMock.mockClear();
    render(<CorsProxyBlock />);
    fireEvent.click(screen.getByRole('button', { name: /set key/i }));
    fireEvent.change(screen.getByLabelText(/access key/i), { target: { value: 'secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: /save key/i }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({
        corsProxy: {
          url: CORS_PROXY_URL,
          sharedKey: { version: 1, ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]) },
        },
      }),
    );
  });

  it('clears without confirm when no proxy-provider is active', () => {
    proxyState = {
      url: 'https://p.example',
      sharedKey: { version: 1, ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]) },
    };
    providerRows = [{ templateId: 'chutes', enabled: true }];
    updateMock.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CorsProxyBlock />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ corsProxy: null });
    confirmSpy.mockRestore();
  });

  it('warns before clearing when a proxy-provider is active', () => {
    proxyState = {
      url: 'https://p.example',
      sharedKey: { version: 1, ciphertext: new Uint8Array([1]), nonce: new Uint8Array([2]) },
    };
    providerRows = [{ templateId: 'wafer', enabled: true }];
    updateMock.mockClear();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CorsProxyBlock />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/wafer/i));
    expect(updateMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
