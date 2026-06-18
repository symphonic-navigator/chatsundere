// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readMock = vi.fn();
const parseMock = vi.fn();
const importMock = vi.fn();

vi.mock('../../src/lib/chatsune-import/archive-reader.js', () => ({
  readChatsuneArchive: (...a: unknown[]) => readMock(...a),
}));
vi.mock('../../src/lib/chatsune-import/knowledge-parse.js', () => ({
  parseKnowledgeExport: (...a: unknown[]) => parseMock(...a),
}));
vi.mock('../../src/data/chatsune-import.js', () => ({
  importChatsuneLibrary: (...a: unknown[]) => importMock(...a),
}));

import { ChatsuneLibraryImport } from '../../src/components/knowledge/ChatsuneLibraryImport.js';

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'lib.tar.gz', { type: 'application/gzip' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function wrap(node: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

describe('ChatsuneLibraryImport', () => {
  afterEach(() => {
    readMock.mockReset();
    parseMock.mockReset();
    importMock.mockReset();
  });

  it('parses and imports a picked library file', async () => {
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockReturnValue({ name: 'Biology', description: '', nsfw: false, documents: [] });
    importMock.mockResolvedValue('lib-1');

    render(wrap(<ChatsuneLibraryImport />));
    pickFile();

    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
    expect(parseMock).toHaveBeenCalled();
  });

  it('surfaces a wrong-format error', async () => {
    readMock.mockResolvedValue({ manifest: {}, files: new Map() });
    parseMock.mockImplementation(() => {
      throw new Error('This is not a knowledge export — pick a Chatsune library file.');
    });
    render(wrap(<ChatsuneLibraryImport />));
    pickFile();
    await waitFor(() => expect(screen.getByText(/not a knowledge export/i)).toBeInTheDocument());
    expect(importMock).not.toHaveBeenCalled();
  });
});
