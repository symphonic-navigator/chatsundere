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

function pill(
  over: Partial<PillRow>,
  payload: Record<string, unknown>,
  toolName = 'create_artefact',
): PillRow {
  return {
    id: 'p1',
    messageId: 'm1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'pending',
    payload: { name: toolName, ...payload },
    createdAt: 0,
    ...over,
  };
}

test('building create still shows the live character count', () => {
  render(wrap(<Pill row={pill({ status: 'pending' }, { title: 'Calc', charCount: 2300 })} />));
  expect(screen.getByText(/2,?300/)).toBeTruthy();
  expect(screen.getByText(/building/)).toBeTruthy();
});

test('pending modify with phase reading shows reading', () => {
  render(
    wrap(
      <Pill
        row={pill({ status: 'pending' }, { title: 'Doc', phase: 'reading' }, 'modify_artefact')}
      />,
    ),
  );
  expect(screen.getByText('reading')).toBeTruthy();
});

test('pending inspect with phase explaining shows explaining', () => {
  render(
    wrap(
      <Pill
        row={pill({ status: 'pending' }, { title: 'Doc', phase: 'explaining' }, 'inspect_artefact')}
      />,
    ),
  );
  expect(screen.getByText('explaining')).toBeTruthy();
});

test('completed markdown create shows MD badge when format in payload', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Notes',
    content: '# hi',
    format: 'markdown',
  });
  render(
    wrap(
      <Pill
        row={pill({ status: 'completed' }, { title: 'Notes', artefactId: id, format: 'markdown' })}
      />,
    ),
  );
  expect(screen.getByText('MD')).toBeTruthy();
});

test('completed markdown modify shows MD badge when format in payload', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Notes',
    content: '# hi',
    format: 'markdown',
  });
  render(
    wrap(
      <Pill
        row={pill(
          { status: 'completed' },
          { title: 'Notes', artefactId: id, format: 'markdown' },
          'modify_artefact',
        )}
      />,
    ),
  );
  expect(screen.getByText('MD')).toBeTruthy();
});

test('completed modify shows updated-ish subtitle', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Doc',
    content: '<x>',
  });
  render(
    wrap(
      <Pill
        row={pill({ status: 'completed' }, { title: 'Doc', artefactId: id }, 'modify_artefact')}
      />,
    ),
  );
  expect(screen.getByText(/updated/i)).toBeTruthy();
});

test('completed inspect shows explained-ish subtitle', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Doc',
    content: '<x>',
  });
  render(
    wrap(
      <Pill
        row={pill({ status: 'completed' }, { title: 'Doc', artefactId: id }, 'inspect_artefact')}
      />,
    ),
  );
  expect(screen.getByText(/explained/i)).toBeTruthy();
});

test('completed pill still opens the artefact on tap when artefactId present', async () => {
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

test('completed modify opens the artefact on tap', async () => {
  const id = await addGeneratedArtefact({
    chatId: 'c1',
    personaId: 'p1',
    title: 'Calc',
    content: '<x>',
  });
  render(
    wrap(
      <Pill
        row={pill({ status: 'completed' }, { title: 'Calc', artefactId: id }, 'modify_artefact')}
      />,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: /Calc/ }));
  expect(useCurrentChatStore.getState().openArtefactId).toBe(id);
});
