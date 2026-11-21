// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { ArtefactPicker } from '../../../src/components/artefact/ArtefactPicker.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

async function seedPersona(id: string): Promise<void> {
  const now = Date.now();
  await getClientDataDb().personas.add({
    id,
    name: 'Mei',
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
    adultPersona: false,
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

async function seedAudio(id: string, personaId: string, title: string): Promise<void> {
  const now = Date.now();
  await getClientDataDb().artefacts.add({
    id,
    chatId: `c-${id}`,
    personaId,
    projectId: null,
    origin: 'generated',
    kind: 'audio',
    format: 'audio',
    title,
    fileName: `${id}.mp3`,
    mime: 'audio/mpeg',
    content: '',
    tags: [],
    favourite: false,
    createdAt: now,
    updatedAt: now,
    mediaMeta: { key: `gen:${id}`, durationMs: 1000, serverName: 'ElevenLabs', toolName: 't' },
  });
}

function renderPicker(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ArtefactPicker chatId="dest" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

test('an audio row is shown but disabled with its reason, and selecting it does nothing', async () => {
  await seedPersona('p1');
  await seedAudio('au1', 'p1', 'Theme song');
  renderPicker();
  const row = await waitFor(() => screen.getByRole('button', { name: /Theme song/ }));
  expect(row).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText("Audio and video can't be sent to a model yet.")).toBeInTheDocument();
  fireEvent.click(row);
  expect(row).toHaveAttribute('aria-pressed', 'false');
  const attach = screen.getByRole('button', { name: /attach \(/i }) as HTMLButtonElement;
  expect(attach.disabled).toBe(true);
  expect(attach.textContent).toContain('(0)');
});

test('the picker offers an Audio & video tab that narrows to media', async () => {
  await seedPersona('p1');
  await seedAudio('au1', 'p1', 'Theme song');
  renderPicker();
  await waitFor(() => screen.getByText('Theme song'));
  fireEvent.click(screen.getByRole('tab', { name: 'Audio & video' }));
  expect(screen.getByText('Theme song')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
  expect(screen.queryByText('Theme song')).not.toBeInTheDocument();
});
