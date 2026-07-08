// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { exportLibraryMock, triggerDownloadMock } = vi.hoisted(() => ({
  exportLibraryMock: vi.fn(async () => new Blob(['x'])),
  triggerDownloadMock: vi.fn(),
}));

vi.mock('../../src/data/chatsundere-export.js', () => ({
  exportLibrary: exportLibraryMock,
  exportPersona: vi.fn(),
}));
vi.mock('../../src/lib/download.js', () => ({
  triggerDownload: triggerDownloadMock,
  slug: (s: string) => s.toLowerCase(),
}));
vi.mock('../../src/state/toast.store.js', () => ({
  toastStore: { show: vi.fn() },
  useToastStore: vi.fn(),
}));

import { LibraryExportOverlay } from '../../src/components/transfer/LibraryExportOverlay.js';

describe('LibraryExportOverlay', () => {
  it('one-tap plaintext export when encryption is off', async () => {
    exportLibraryMock.mockClear();
    triggerDownloadMock.mockClear();
    render(<LibraryExportOverlay libraryId="lib-1" libraryName="Lore" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(exportLibraryMock).toHaveBeenCalledWith('lib-1');
    await Promise.resolve();
    expect(triggerDownloadMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('-chatsundere.tar.gz'),
    );
  });

  it('encrypts with a matching password', async () => {
    exportLibraryMock.mockClear();
    render(<LibraryExportOverlay libraryId="lib-2" libraryName="Lore" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    expect(exportLibraryMock).toHaveBeenCalledWith('lib-2', 'pw');
  });
});
