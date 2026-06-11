// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { Treasury } from '../../src/routes/app/treasury.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

// Seed a persona exactly as circle.filter.test.tsx / entrance-hall.filter.test.tsx
// do (SFW persona with a full PersonaRow shape) so useFilteredPersonas returns it.
async function seedPersona(id: string, name: string, adultPersona = false): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
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
    createdAt: now,
    updatedAt: now,
  });
}

/** Insert an artefact for a persona carrying a single tag. */
async function seedTaggedArtefact(
  id: string,
  personaId: string,
  title: string,
  tag: string,
): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();
  await db.artefacts.add({
    id,
    chatId: `chat-${id}`,
    personaId,
    projectId: null,
    origin: 'generated',
    kind: 'text',
    format: 'html',
    title,
    fileName: `${title}.html`,
    mime: 'text/html',
    content: '<x>',
    tags: [tag],
    favourite: false,
    createdAt: now,
    updatedAt: now,
  });
}

function wrap(): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/treasury']}>
        <Treasury />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

test('lists artefacts across chats; type tab filters by derived type', async () => {
  await seedPersona('p1', 'Mei');
  await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'Pomodoro', content: '<x>' });
  const db = getClientDataDb();
  await db.artefacts.add({
    id: 'md1',
    chatId: 'c2',
    personaId: 'p1',
    projectId: null,
    origin: 'saved-message',
    kind: 'text',
    format: 'markdown',
    title: 'Notes',
    fileName: 'notes.md',
    mime: 'text/markdown',
    content: '# hi',
    tags: [],
    favourite: false,
    createdAt: 1,
    updatedAt: 1,
  });
  render(wrap());
  await waitFor(() => screen.getByText('Pomodoro'));
  expect(screen.getByText('Notes')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));
  expect(screen.queryByText('Pomodoro')).not.toBeInTheDocument();
  expect(screen.getByText('Notes')).toBeInTheDocument();
});

test('select mode → bulk delete removes the chosen artefacts', async () => {
  await seedPersona('p1', 'Mei');
  await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'Keep', content: '<x>' });
  await addGeneratedArtefact({ chatId: 'c1', personaId: 'p1', title: 'Drop', content: '<x>' });
  render(wrap());
  await waitFor(() => screen.getByText('Drop'));
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  fireEvent.click(screen.getByRole('button', { name: /Drop/ }));
  fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
  fireEvent.click(screen.getByRole('button', { name: /Delete 1/ }));
  await waitFor(() => expect(screen.queryByText('Drop')).not.toBeInTheDocument());
  expect(screen.getByText('Keep')).toBeInTheDocument();
});

test('hidden (adult-in-SFW) persona artefacts and tags do not leak into Treasury', async () => {
  // p1 is a normal persona (visible); p2 is an adult persona hidden while SFW.
  await seedPersona('p1', 'Mei', false);
  await seedPersona('p2', 'Spicy', true);
  await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
  await seedTaggedArtefact('a1', 'p1', 'Visible', 'safe');
  await seedTaggedArtefact('a2', 'p2', 'Hidden', 'secret');

  render(wrap());

  // Row-level: only the visible persona's artefact shows.
  await waitFor(() => screen.getByText('Visible'));
  expect(screen.queryByText('Hidden')).not.toBeInTheDocument();

  // Tag-level: open the filter sheet and confirm only the visible persona's
  // tag is offered as a suggestion — the hidden persona's tag must not leak.
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  await waitFor(() => screen.getByRole('button', { name: 'Add tag safe' }));
  expect(screen.queryByRole('button', { name: 'Add tag secret' })).not.toBeInTheDocument();
});
