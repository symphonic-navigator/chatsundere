// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Circle } from '../../src/routes/app/circle.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

async function seedSfwAndNsfw() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: 'p-sfw',
    name: 'Calm',
    tagline: '',
    colour: '#fff',
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
    createdAt: now,
    updatedAt: now,
  });
  await db.personas.add({
    id: 'p-nsfw',
    name: 'Spicy',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: true,
    createdAt: now + 1,
    updatedAt: now + 1,
  });
}

function renderCircle() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Circle />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Circle filter (adult mode)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('NSFW mode shows both personas', async () => {
    await seedSfwAndNsfw();
    renderCircle();
    await waitFor(() => expect(screen.getByText('Calm')).toBeInTheDocument());
    expect(screen.getByText('Spicy')).toBeInTheDocument();
  });

  it('SFW mode hides adult personas (no-leak: no hint anywhere)', async () => {
    await seedSfwAndNsfw();
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    renderCircle();
    await waitFor(() => expect(screen.getByText('Calm')).toBeInTheDocument());
    expect(screen.queryByText('Spicy')).toBeNull();
    // No-leak assertions: no text mentioning "hidden", "NSFW", count differences, etc.
    expect(screen.queryByText(/hidden/i)).toBeNull();
    expect(screen.queryByText(/nsfw/i)).toBeNull();
    expect(screen.queryByText(/switch to/i)).toBeNull();
  });

  it('resets the global mindspace store to the user default on mount', async () => {
    // Pretend a previous route (e.g. Persona-Editor) left a persona-specific
    // mindspace in the store. Circle's mount-effect must overwrite it with
    // the user default (persona: null).
    useMindspaceStore.setState({
      resolved: {
        id: 'wrong-id',
        displayName: 'Wrong',
        palette: {
          bg: '#000',
          surfaceBase: '',
          surfaceRaised: '',
          surfaceInput: '',
          accent: '#fff',
          accentSubtle: '',
          accentBorder: '',
          accentBorderActive: '',
          accentGlow: '',
          text: { primary: '', secondary: '', muted: '', ghost: '' },
        },
        texture: 'cloudy',
        builtIn: false,
        createdAt: 0,
      },
    });
    renderCircle();
    await waitFor(() => {
      const r = useMindspaceStore.getState().resolved;
      expect(r?.id).not.toBe('wrong-id');
    });
  });

  it('SFW mode with ALL personas adult shows identical "no personas yet" empty state', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p-only-nsfw',
      name: 'OnlyNsfw',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'i',
      canonicalId: null,
      providerId: 'np',
      modelId: 'm',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.settings.update(1, { adultMode: 'sfw' });
    renderCircle();
    await waitFor(() => expect(screen.getByText(/no personas yet/i)).toBeInTheDocument());
    expect(screen.queryByText('OnlyNsfw')).toBeNull();
    // Same empty-state copy as the fresh-install / never-created scenario.
    expect(screen.getByText(/tap the/i)).toBeInTheDocument();
  });
});
