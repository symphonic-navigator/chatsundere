// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { PersonaEditor } from '../../src/routes/app/persona-editor.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

async function seedPersonaWithMindspace() {
  const db = getClientDataDb();
  const now = Date.now();
  const mindspaces = await db.mindspaces.toArray();
  const verdan = mindspaces.find((m) => m.displayName === 'Verdan');
  if (!verdan) throw new Error('test fixture: Verdan mindspace not seeded');
  await db.personas.add({
    id: 'p-1',
    name: 'TestPersona',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
    mindspaceId: verdan.id,
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
  return verdan.id;
}

function renderEditor(personaId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}`]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Persona Editor mindspace transition', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useMindspaceStore.setState({ resolved: null });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useMindspaceStore.setState({ resolved: null });
  });

  it("updates the global mindspace store with the persona's resolved mindspace on mount", async () => {
    const verdanId = await seedPersonaWithMindspace();
    renderEditor('p-1');
    await waitFor(() => {
      const r = useMindspaceStore.getState().resolved;
      expect(r?.id).toBe(verdanId);
    });
  });
});
