// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

function wrap(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
          <Route path="/app/persona/new" element={<PersonaEditor />} />
          <Route path="/app/circle" element={<div data-testid="circle" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PersonaEditor — Identity / Instructions / About-Me-Override', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders topbar with "New Persona" in create mode', async () => {
    wrap('/app/persona/new');
    await waitFor(() => expect(screen.getByText(/new persona/i)).toBeInTheDocument());
  });

  it('renders persona name in topbar context in edit mode', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p-edit',
      name: 'Vix',
      tagline: '',
      colour: '#b33a5e',
      font: 'sans',
      instructions: 'i',
      canonicalId: null,
      providerId: 'pv',
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
      createdAt: now,
      updatedAt: now,
    });
    wrap('/app/persona/p-edit');
    await waitFor(() => {
      const topbar = screen.getAllByText('Vix');
      expect(topbar.length).toBeGreaterThan(0);
    });
  });

  it('Identity inputs are always visible and name field accepts edits', async () => {
    wrap('/app/persona/new');
    // Identity is outside any accordion — the name input is always visible
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Lyra' } });
    // The input itself reflects the change; in create mode the topbar title
    // stays as "New Persona" (the draft name is only shown in the title in
    // edit mode where draft.name || 'Edit Persona' is used).
    await waitFor(() => expect((nameInput as HTMLInputElement).value).toBe('Lyra'));
  });
});

describe('PersonaEditor — Mindspace / Model / Behavior', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('Mindspace-Override picker offers "Use user default" chip', async () => {
    wrap('/app/persona/new');
    fireEvent.click(await screen.findByText(/mindspace.*override/i));
    expect(await screen.findByRole('button', { name: /use user default/i })).toBeInTheDocument();
  });

  it('Behavior section shows temperature slider with default 0.85', async () => {
    wrap('/app/persona/new');
    fireEvent.click(await screen.findByText(/behavior/i));
    expect(await screen.findByText('0.85')).toBeInTheDocument();
  });

  it('Behavior section shows Adult Persona toggle', async () => {
    wrap('/app/persona/new');
    fireEvent.click(await screen.findByText(/behavior/i));
    expect(await screen.findByText(/adult persona/i)).toBeInTheDocument();
  });
});

describe('PersonaEditor — Delete + Save-And-Back', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('disables Save & Back when name is empty', async () => {
    wrap('/app/persona/new');
    const save = await screen.findByRole('button', { name: /save & back/i });
    expect(save).toBeDisabled();
  });

  it('still disables Save & Back when name filled but no providerId or modelId', async () => {
    wrap('/app/persona/new');
    // Identity is always visible — no accordion to open
    const nameInput = await screen.findByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Aurum' } });
    // Provider and model also required — none seeded, so Save stays disabled
    const save = screen.getByRole('button', { name: /save & back/i });
    expect(save).toBeDisabled();
  });

  it('shows Delete zone only in edit mode', async () => {
    const now = Date.now();
    const db = getClientDataDb();
    await db.personas.add({
      id: 'p-del',
      name: 'X',
      tagline: '',
      colour: '#fff',
      font: 'sans',
      instructions: 'i',
      canonicalId: null,
      providerId: 'pv',
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
      createdAt: now,
      updatedAt: now,
    });
    wrap('/app/persona/p-del');
    expect(await screen.findByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});
