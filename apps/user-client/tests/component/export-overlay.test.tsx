// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Spy references hoisted so vi.mock factories can reference them.
const { exportPersonaMock, triggerDownloadMock } = vi.hoisted(() => ({
  exportPersonaMock: vi.fn(async () => new Blob(['x'])),
  triggerDownloadMock: vi.fn(),
}));

vi.mock('../../src/data/chatsundere-export.js', () => ({
  exportPersona: exportPersonaMock,
  exportLibrary: vi.fn(),
}));

vi.mock('../../src/lib/download.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/download.js')>();
  return { ...actual, triggerDownload: triggerDownloadMock };
});

// Stub toast so store state does not bleed between tests.
vi.mock('../../src/state/toast.store.js', () => ({
  toastStore: { show: vi.fn() },
  useToastStore: vi.fn(),
}));

import { ExportOverlay } from '../../src/components/transfer/ExportOverlay.js';

describe('ExportOverlay', () => {
  it('defaults Memory/Artefacts on and Images off, and exports on confirm', () => {
    render(<ExportOverlay personaId="p1" personaName="Fable" onClose={() => {}} />);

    expect((screen.getByLabelText(/memory/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/artefacts/i) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/images/i) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(exportPersonaMock).toHaveBeenCalledWith('p1', {
      memory: true,
      artefacts: true,
      images: false,
    });
  });

  it('passes toggled values through to exportPersona', () => {
    exportPersonaMock.mockClear();
    render(<ExportOverlay personaId="p2" personaName="Nova" onClose={() => {}} />);

    // Turn Memory off and Images on.
    fireEvent.click(screen.getByLabelText(/memory/i));
    fireEvent.click(screen.getByLabelText(/images/i));

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(exportPersonaMock).toHaveBeenCalledWith('p2', {
      memory: false,
      artefacts: true,
      images: true,
    });
  });

  it('encrypts and names the file -encrypted when a matching password is set', async () => {
    exportPersonaMock.mockClear();
    triggerDownloadMock.mockClear();
    render(<ExportOverlay personaId="p3" personaName="Ivy" onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));

    expect(exportPersonaMock).toHaveBeenCalledWith(
      'p3',
      { memory: true, artefacts: true, images: false },
      'secret',
    );
    await Promise.resolve();
    expect(triggerDownloadMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('-chatsundere-encrypted.tar.gz'),
    );
  });

  it('disables Export while the passwords do not match', () => {
    render(<ExportOverlay personaId="p4" personaName="Jae" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/encrypt with a password/i));
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'b' } });
    expect((screen.getByRole('button', { name: /^export$/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
