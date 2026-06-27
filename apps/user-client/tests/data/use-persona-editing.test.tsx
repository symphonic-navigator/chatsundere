// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { usePersonaEditing } from '../../src/routes/app/persona/use-persona-editing.js';

const TEST_PERSONA_ID = 'persona-editing-test-01';

async function seedPersona() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: TEST_PERSONA_ID,
    name: 'Aurum',
    tagline: 'quiet sparring',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'be present',
    canonicalId: null,
    providerId: 'nano-gpt-row',
    modelId: 'deepseek-v4-flash',
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

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('usePersonaEditing', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersona();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('loads the persona and patch writes immediately to the DB', async () => {
    const W = wrapper();
    const { result } = renderHook(() => usePersonaEditing(TEST_PERSONA_ID), { wrapper: W });

    await waitFor(() => expect(result.current.persona?.id).toBe(TEST_PERSONA_ID));

    await act(async () => {
      await result.current.patch({ temperature: 1.2 });
    });

    const db = getClientDataDb();
    await waitFor(async () => {
      const row = await db.personas.get(TEST_PERSONA_ID);
      expect(row?.temperature).toBe(1.2);
    });
  });

  it('returns null persona when id is null', async () => {
    const W = wrapper();
    const { result } = renderHook(() => usePersonaEditing(null), { wrapper: W });

    // Query is disabled for null id — persona stays undefined/null, patch is a no-op
    expect(result.current.persona).toBeUndefined();
    // patch with null id must not throw
    await act(async () => {
      await result.current.patch({ temperature: 0.5 });
    });
  });
});
