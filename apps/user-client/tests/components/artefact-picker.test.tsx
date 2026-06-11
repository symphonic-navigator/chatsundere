// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { ArtefactPicker } from '../../src/components/artefact/ArtefactPicker.js';
import { listPendingAttachments } from '../../src/data/attachments.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

async function seedPersona(id: string, name: string, adultPersona = false): Promise<void> {
  const now = Date.now();
  await getClientDataDb().personas.add({
    id,
    name,
    tagline: '',
    colour: '#8d6dff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedArtefact(
  id: string,
  personaId: string,
  title: string,
  format: 'html' | 'markdown',
): Promise<void> {
  const now = Date.now();
  await getClientDataDb().artefacts.add({
    id,
    chatId: `c-${id}`,
    personaId,
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format,
    title,
    fileName: `${title}.${format === 'html' ? 'html' : 'md'}`,
    mime: format === 'html' ? 'text/html' : 'text/markdown',
    content: '<x>',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  });
}

function renderPicker(onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ArtefactPicker chatId="dest" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('ArtefactPicker', () => {
  it('lists visible artefacts and hides NSFW-persona artefacts in SFW mode', async () => {
    await seedPersona('sfw', 'Mei', false);
    await seedPersona('nsfw', 'Noir', true);
    // adultMode defaults to 'nsfw' (settings seed) — force SFW so the adult
    // persona is filtered out, mirroring the Treasury NSFW-leak test.
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'nsfw', 'Secret', 'html');
    renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('filters by type tab and by search', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'sfw', 'Notes', 'markdown');
    renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(screen.queryByText('Pomodoro')).not.toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.change(screen.getByPlaceholderText(/search artefacts/i), {
      target: { value: 'pomo' },
    });
    expect(screen.getByText('Pomodoro')).toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('Attach is disabled until something is selected; the count reflects selection', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    const attach = (): HTMLButtonElement => screen.getByRole('button', { name: /attach \(/i });
    expect(attach().disabled).toBe(true);
    expect(attach().textContent).toContain('(0)');
    fireEvent.click(screen.getByText('Pomodoro'));
    expect(attach().disabled).toBe(false);
    expect(attach().textContent).toContain('(1)');
  });

  it('attaching snapshots the selection into the chat and closes', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'sfw', 'Notes', 'markdown');
    const { onClose } = renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByText('Notes'));
    fireEvent.click(screen.getByRole('button', { name: /attach \(2\)/i }));
    await waitFor(async () => expect(await listPendingAttachments('dest')).toHaveLength(2));
    expect(onClose).toHaveBeenCalled();
  });

  it('attaches artefacts selected before a tab switch (selection persists across filters)', async () => {
    await seedPersona('sfw', 'Mei');
    await seedArtefact('a1', 'sfw', 'Pomodoro', 'html');
    await seedArtefact('a2', 'sfw', 'Notes', 'markdown');
    const { onClose } = renderPicker();
    await waitFor(() => screen.getByText('Pomodoro'));
    fireEvent.click(screen.getByText('Pomodoro')); // select the HTML artefact
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' })); // switch tab — Pomodoro now hidden
    fireEvent.click(screen.getByRole('button', { name: /attach \(1\)/i }));
    await waitFor(async () => expect(await listPendingAttachments('dest')).toHaveLength(1));
    expect(onClose).toHaveBeenCalled();
  });
});
