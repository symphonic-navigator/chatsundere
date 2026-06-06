// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import 'fake-indexeddb/auto';
import type { PillRow } from '../../src/boot/client-data-db.js';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Pill } from '../../src/components/chat/Pill.js';
import { addGeneratedArtefact } from '../../src/data/artefacts.js';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

function pill(over: Partial<PillRow>, payload: Record<string, unknown>): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'pending',
    payload: { name: 'create_artefact', ...payload },
    createdAt: 0,
    ...over,
  };
}

test('building state shows the live character count', () => {
  render(wrap(<Pill row={pill({ status: 'pending' }, { title: 'Calc', charCount: 2300 })} />));
  expect(screen.getByText(/2,?300/)).toBeTruthy();
});

test('completed pill opens the artefact on tap', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Calc',
    content: '<x>',
  });
  render(wrap(<Pill row={pill({ status: 'completed' }, { title: 'Calc', artefactId: id })} />));
  fireEvent.click(screen.getByRole('button', { name: /Calc/ }));
  expect(useCurrentChatStore.getState().openArtefactId).toBe(id);
});
