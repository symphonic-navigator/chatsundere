// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useFilteredPersonas } from '../../src/data/personas.js';
import { useAdultMode } from '../../src/data/settings.js';

async function seedPersonas() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: 'p-sfw',
    name: 'Calm',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'x',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.personas.add({
    id: 'p-nsfw',
    name: 'Spicy',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'x',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: true,
    chatsundereTonality: true,
    createdAt: now + 1,
    updatedAt: now + 1,
  });
}

function Probe(): JSX.Element {
  const personas = useFilteredPersonas();
  const { toggleMode } = useAdultMode();
  return (
    <div>
      <span data-testid="count">{personas.data?.length ?? 'loading'}</span>
      <span data-testid="names">{(personas.data ?? []).map((p) => p.name).join(',')}</span>
      <button data-testid="toggle" type="button" onClick={() => void toggleMode()}>
        toggle
      </button>
    </div>
  );
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useFilteredPersonas', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersonas();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('NSFW mode returns all personas', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('names').textContent).toBe('Calm,Spicy');
  });

  it('SFW mode filters out adultPersona: true', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('names').textContent).toBe('Calm');
  });

  it('reacts to mode change without remount', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await act(async () => screen.getByTestId('toggle').click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    await act(async () => screen.getByTestId('toggle').click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
  });
});
