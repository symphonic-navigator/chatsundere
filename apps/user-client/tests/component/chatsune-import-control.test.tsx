// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const parseMock = vi.fn();
const readMock = vi.fn();
const previewMock = vi.fn();

vi.mock('../../src/lib/chatsune-import/archive-reader.js', () => ({
  readChatsuneArchive: (...a: unknown[]) => readMock(...a),
}));
vi.mock('../../src/lib/chatsune-import/persona-parse.js', () => ({
  parsePersonaExport: (...a: unknown[]) => parseMock(...a),
}));
vi.mock('../../src/data/chatsune-import.js', () => ({
  previewChatsuneSessions: (...a: unknown[]) => previewMock(...a),
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
  });

  it('parses a picked file, previews counts, and applies on confirm', async () => {
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockReturnValue({
      persona: { name: 'Fable', tagline: 't', instructions: 'i', nsfw: true },
      avatar: null,
      sessions: [{ original_id: 's1', session_fields: {}, messages: [] }],
      memoryCount: 3,
    });
    previewMock.mockResolvedValue({ newCount: 1, skippedCount: 0 });
    const onApply = vi.fn();

    render(<ChatsuneImportControl mode="create" personaId={null} onApply={onApply} />);
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
    readMock.mockRejectedValue(new Error('Could not read this file — is it a Chatsune export?'));
    render(<ChatsuneImportControl mode="create" personaId={null} onApply={vi.fn()} />);
    pickFile();
    await waitFor(() => expect(screen.getByText(/could not read this file/i)).toBeInTheDocument());
  });
});
