// apps/user-client/tests/unit/third-party-import-overlay.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { ThirdPartyImportOverlay } from '../../src/components/persona-editor/ThirdPartyImportOverlay.js';
import { relativeTimeLabel } from '../../src/lib/relative-time.js';
import type { ParseResult } from '../../src/lib/third-party-import/types.js';

const ZERO = { images: 0, toolCalls: 0, attachments: 0, artefacts: 0, knowledgeLookups: 0 };
const T0 = 1721300000000;

function convOf(
  sourceId: string,
  title: string,
  messageCount = 1,
): ParseResult['conversations'][number] {
  return {
    sourceId,
    source: 'chatgpt',
    title,
    createdAt: T0,
    lastMessageAt: T0,
    messages: Array.from({ length: messageCount }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('persona' as const),
      createdAt: T0 + i,
      blocks: [{ type: 'text' as const, text: `m${i}` }],
      dropped: { ...ZERO },
    })),
  };
}

function renderOverlay(result: ParseResult): void {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ThirdPartyImportOverlay
          personaId="p1"
          personaName="Fable"
          onClose={() => undefined}
          parseFile={() => ({ result: Promise.resolve(result), cancel: () => undefined })}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pickFile(): Promise<void> {
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input as HTMLInputElement, {
    target: { files: [new File(['x'], 'conversations.json')] },
  });
  await waitFor(() => expect(screen.queryByText('Reading your export…')).toBeNull());
}

describe('ThirdPartyImportOverlay', () => {
  beforeEach(async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    const now = Date.now();
    await db.mindspaces.add({
      id: 'ms1',
      name: 'D',
      instructions: '',
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.settings.put({ id: 1, defaultMindspaceId: 'ms1' } as never);
    await db.personas.add({ id: 'p1', name: 'Fable', createdAt: now, updatedAt: now } as never);
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('names the persona in the pick state', () => {
    renderOverlay({ source: 'chatgpt', conversations: [], failures: [] });
    expect(
      screen.getByText('These arrive as chats with Fable and continue in their voice.'),
    ).toBeInTheDocument();
  });

  it('lists conversations with disabled reasons and gates the import button', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'c-old',
      personaId: 'p1',
      title: 'Old',
      resolvedMindspaceId: 'ms1',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
      importedFrom: 'chatgpt/done',
    });
    renderOverlay({
      source: 'chatgpt',
      conversations: [
        convOf('chatgpt/new', 'Fresh one', 2),
        convOf('chatgpt/done', 'Old one'),
        convOf('chatgpt/empty', 'Empty one', 0),
      ],
      failures: [{ title: 'Broken one', reason: 'Unreadable conversation structure' }],
    });
    await pickFile();

    expect(await screen.findByText('Fresh one')).toBeInTheDocument();
    expect(screen.getByText('Already imported')).toBeInTheDocument();
    expect(screen.getByText('Nothing importable')).toBeInTheDocument();
    expect(screen.getByText('Unreadable conversation structure')).toBeInTheDocument();
    // Spec §3: importable rows show date + message count as decision aids — reuse
    // the same relative-time label HistoryRow uses, so the exact format isn't pinned here.
    expect(screen.getByText(`${relativeTimeLabel(T0)} · 2 messages`)).toBeInTheDocument();

    const importBtn = screen.getByRole('button', { name: /Import 0 chats/ });
    expect(importBtn).toBeDisabled();
    expect(importBtn).toHaveAttribute('title', 'Select at least one chat to import.');

    fireEvent.click(screen.getByRole('button', { name: 'Select all 1' }));
    expect(screen.getByRole('button', { name: 'Import 1 chat' })).toBeEnabled();
  });

  it('disables Select all with a reason when there is nothing to select', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.chats.add({
      id: 'c-old',
      personaId: 'p1',
      title: 'Old',
      resolvedMindspaceId: 'ms1',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
      importedFrom: 'chatgpt/done',
    });
    renderOverlay({
      source: 'chatgpt',
      conversations: [convOf('chatgpt/done', 'Old one'), convOf('chatgpt/empty', 'Empty one', 0)],
      failures: [],
    });
    await pickFile();

    const selectAllBtn = await screen.findByRole('button', { name: 'Select all 0' });
    expect(selectAllBtn).toBeDisabled();
    expect(selectAllBtn).toHaveAttribute('title', 'No conversations to select.');
  });

  it('scopes select-all to the active search filter', async () => {
    renderOverlay({
      source: 'chatgpt',
      conversations: Array.from({ length: 12 }, (_, i) =>
        convOf(`chatgpt/c${i}`, i < 3 ? `Recipe ${i}` : `Other ${i}`),
      ),
      failures: [],
    });
    await pickFile();
    const search = await screen.findByPlaceholderText('Search by title');
    fireEvent.change(search, { target: { value: 'recipe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all 3 matches' }));
    expect(screen.getByRole('button', { name: 'Import 3 chats' })).toBeEnabled();
  });

  it('imports the selection and offers View history', async () => {
    renderOverlay({
      source: 'chatgpt',
      conversations: [convOf('chatgpt/one', 'Only one', 2)],
      failures: [],
    });
    await pickFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Select all 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 chat' }));

    expect(await screen.findByText('Imported 1 chat.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View history' })).toBeInTheDocument();
    const chats = await getClientDataDb().chats.where('personaId').equals('p1').toArray();
    expect(chats.map((c) => c.importedFrom)).toEqual(['chatgpt/one']);
  });

  it('cancels the parse worker when Escape closes the overlay mid-parse', async () => {
    const qc = new QueryClient();
    const cancel = vi.fn();
    const neverResolves = new Promise<ParseResult>(() => undefined);
    neverResolves.catch(() => undefined);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ThirdPartyImportOverlay
            personaId="p1"
            personaName="Fable"
            onClose={() => undefined}
            parseFile={() => ({ result: neverResolves, cancel })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['x'], 'conversations.json')] },
    });
    expect(await screen.findByText('Reading your export…')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('shows the constructive error for an unrecognised file and keeps the picker', async () => {
    const qc = new QueryClient();
    const { ParseExportError } = await import('../../src/lib/third-party-import/worker-host.js');
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ThirdPartyImportOverlay
            personaId="p1"
            personaName="Fable"
            onClose={() => undefined}
            parseFile={() => ({
              result: Promise.reject(new ParseExportError('unrecognised', 'nope')),
              cancel: () => undefined,
            })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await pickFile();
    expect(
      await screen.findByText(
        "That doesn't look like a ChatGPT or Grok export. Pick the .zip you downloaded from ChatGPT, or the .json file from Grok.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });
});
