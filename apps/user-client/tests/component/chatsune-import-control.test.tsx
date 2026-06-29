// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const parseMock = vi.fn();
const readMock = vi.fn();
const previewMock = vi.fn();
const readManifestFormatMock = vi.fn();

vi.mock('../../src/lib/chatsune-import/archive-reader.js', () => ({
  readChatsuneArchive: (...a: unknown[]) => readMock(...a),
}));
vi.mock('../../src/lib/chatsune-import/persona-parse.js', () => ({
  parsePersonaExport: (...a: unknown[]) => parseMock(...a),
}));
vi.mock('../../src/data/chatsune-import.js', () => ({
  previewChatsuneSessions: (...a: unknown[]) => previewMock(...a),
}));
// Needed since Task 10: the component gates on readManifestFormat before
// reaching the Chatsune-archive path. Return 'chatsune/persona' so these
// tests exercise the existing Chatsune flow (not the new Chatsundere path).
vi.mock('../../src/lib/chatsundere-transfer/import-detect.js', () => ({
  readManifestFormat: (...a: unknown[]) => readManifestFormatMock(...a),
  readManifestJson: vi.fn(),
}));

import { ChatsuneImportControl } from '../../src/components/persona-editor/ChatsuneImportControl.js';

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'export.tar.gz', { type: 'application/gzip' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('ChatsuneImportControl', () => {
  afterEach(() => {
    parseMock.mockReset();
    readMock.mockReset();
    previewMock.mockReset();
    readManifestFormatMock.mockReset();
  });

  it('parses a picked file, previews counts, and applies on confirm', async () => {
    readManifestFormatMock.mockResolvedValue('chatsune/persona');
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockReturnValue({
      persona: { name: 'Fable', tagline: 't', instructions: 'i', nsfw: true },
      avatar: null,
      sessions: [{ original_id: 's1', session_fields: {}, messages: [] }],
      memoryCount: 3,
    });
    previewMock.mockResolvedValue({ newCount: 1, skippedCount: 0 });
    const onApply = vi.fn();

    render(
      <MemoryRouter>
        <ChatsuneImportControl mode="create" personaId={null} onApply={onApply} />
      </MemoryRouter>,
    );
    pickFile();

    await waitFor(() => expect(screen.getByText(/Fable/)).toBeInTheDocument());
    expect(screen.getByText(/1 new/)).toBeInTheDocument();
    expect(screen.getByText(/3 memories/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /apply import/i }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: expect.objectContaining({ name: 'Fable' }),
        overwriteConfig: true, // create mode → always apply fields
        newChatCount: 1,
      }),
    );
  });

  it('surfaces a parse error', async () => {
    readManifestFormatMock.mockResolvedValue('chatsune/persona');
    readMock.mockRejectedValue(new Error('Could not read this file — is it a Chatsune export?'));
    render(
      <MemoryRouter>
        <ChatsuneImportControl mode="create" personaId={null} onApply={vi.fn()} />
      </MemoryRouter>,
    );
    pickFile();
    await waitFor(() => expect(screen.getByText(/could not read this file/i)).toBeInTheDocument());
  });
});
