// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { PillRow } from '../../src/boot/client-data-db.js';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { ImagePill } from '../../src/components/chat/ImagePill.js';
import { Pill } from '../../src/components/chat/Pill.js';
import { addGeneratedImageArtefact } from '../../src/data/artefacts.js';

// JSDOM's structuredClone does not preserve Blob objects — it serialises them
// to plain `{}`. fake-indexeddb calls structuredClone when writing a row, so
// Blob fields stored in IndexedDB come back empty in tests.  Patch the global
// to re-attach any Blob fields after the clone so the thumbnails resolve.
{
  const _orig = globalThis.structuredClone;
  // biome-ignore lint/suspicious/noExplicitAny: test-only shim
  (globalThis as any).structuredClone = function blobPreservingClone<T>(
    value: T,
    opts?: StructuredSerializeOptions,
  ): T {
    const cloned = _orig(value, opts);
    if (value && typeof value === 'object' && !(value instanceof Blob)) {
      for (const key of Object.keys(value as object)) {
        // biome-ignore lint/suspicious/noExplicitAny: test-only shim
        if ((value as any)[key] instanceof Blob) (cloned as any)[key] = (value as any)[key];
      }
    }
    return cloned;
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
  vi.unstubAllGlobals();
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
    payload: { name: 'generate_image', ...payload },
    createdAt: 0,
    ...over,
  };
}

async function seedImageArtefact(prompt: string): Promise<string> {
  return addGeneratedImageArtefact({
    chatId: 'c1',
    personaId: 'pe1',
    prompt,
    modelRef: 'nano-gpt:z-image-turbo',
    modelLabel: 'Z-Image',
    configSnapshot: { groupId: 'zimage', variant: 'turbo', size: '1024x1024' },
    bytes: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    mime: 'image/jpeg',
    thumbBlob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
    width: 1024,
    height: 1024,
  });
}

test('pending with a count shows how many images are being painted', () => {
  render(
    wrap(
      <ImagePill
        row={pill({ status: 'pending' }, { argumentsJson: '{"prompt":"a fox","count":3}' })}
      />,
    ),
  );
  expect(screen.getByText(/Painting 3 images/)).toBeInTheDocument();
});

test('pending with unparseable arguments falls back without crashing', () => {
  render(wrap(<ImagePill row={pill({ status: 'pending' }, { argumentsJson: '{"pro' })} />));
  expect(screen.getByText(/Painting/)).toBeInTheDocument();
  expect(screen.getByText('image model')).toBeInTheDocument();
});

test('completed pill expands to the prompt with a working Copy button', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  render(
    wrap(
      <ImagePill
        row={pill(
          { status: 'completed' },
          { prompt: 'a fox', modelLabel: 'Z-Image', artefactIds: ['a1'], moderatedReasons: [] },
        )}
      />,
    ),
  );
  expect(screen.queryByText('a fox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/Painted · Z-Image/));
  expect(screen.getByText('a fox')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  // waitFor also flushes the (empty) artefact query kicked off by artefactIds.
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('a fox'));
});

test('completed pill renders one thumbnail per stored artefact', async () => {
  const id1 = await seedImageArtefact('first fox');
  const id2 = await seedImageArtefact('second fox');
  render(
    wrap(
      <ImagePill
        row={pill(
          { status: 'completed' },
          {
            prompt: 'a fox',
            modelLabel: 'Z-Image',
            artefactIds: [id1, id2],
            moderatedReasons: [],
          },
        )}
      />,
    ),
  );
  expect(await screen.findByAltText('first fox')).toBeInTheDocument();
  expect(screen.getByAltText('second fox')).toBeInTheDocument();
});

test('failed pill expands to reveal the error', () => {
  const error = 'No image model is configured yet. Ask the user to pick one in Settings.';
  render(wrap(<ImagePill row={pill({ status: 'failed' }, { error })} />));
  expect(screen.getByText(/Couldn't paint/)).toBeInTheDocument();
  expect(screen.queryByText(/No image model/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/Couldn't paint/));
  expect(screen.getByText(/No image model is configured yet/)).toBeInTheDocument();
});

test('Pill dispatches generate_image tool-calls to the ImagePill', () => {
  render(
    wrap(
      <Pill row={pill({ status: 'pending' }, { argumentsJson: '{"prompt":"a fox","count":1}' })} />,
    ),
  );
  expect(screen.getByText(/Painting/)).toBeInTheDocument();
});

test('lightbox shows provenance when a thumbnail is clicked', async () => {
  const id1 = await seedImageArtefact('a snowy owl');
  render(
    wrap(
      <ImagePill
        row={pill(
          { status: 'completed' },
          {
            prompt: 'a snowy owl',
            modelLabel: 'Z-Image',
            artefactIds: [id1],
            moderatedReasons: [],
          },
        )}
      />,
    ),
  );
  // Wait for the thumbnail to appear, then click it to open the lightbox.
  const thumb = await screen.findByAltText('a snowy owl');
  fireEvent.click(thumb);
  // The lightbox provenance line should contain the prompt.
  await waitFor(() => expect(screen.getByLabelText('Source')).toBeInTheDocument());
  expect(screen.getByLabelText('Source').textContent).toContain('a snowy owl');
});

test('thumbnails survive a StrictMode remount with a warm query cache', async () => {
  // Device-found bug class: object URLs revoked while an <img> still
  // references them. The first display works (the artefact query resolves
  // asynchronously), but a remount with warm cached data delivered the rows
  // synchronously, and StrictMode's mount effect cycle (effect → cleanup →
  // effect) revoked URLs created during render with no way to recreate them.
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  let seq = 0;
  const live = new Set<string>();
  URL.createObjectURL = () => {
    const u = `blob:test-${seq}`;
    seq += 1;
    live.add(u);
    return u;
  };
  URL.revokeObjectURL = (u: string) => {
    live.delete(u);
  };

  try {
    const id1 = await seedImageArtefact('a raccoon statue');
    const client = new QueryClient();
    const ui = (
      <StrictMode>
        <QueryClientProvider client={client}>
          <ImagePill
            row={pill(
              { status: 'completed' },
              {
                prompt: 'a raccoon statue',
                modelLabel: 'Z-Image',
                artefactIds: [id1],
                moderatedReasons: [],
              },
            )}
          />
        </QueryClientProvider>
      </StrictMode>
    );

    const first = render(ui);
    await first.findByAltText('a raccoon statue');
    first.unmount();

    // Remount with the warm cache — the path the device test hit by
    // navigating to the entrance hall and straight back into the chat.
    const second = render(ui);
    const img = (await second.findByAltText('a raccoon statue')) as HTMLImageElement;
    await waitFor(() => expect(live.has(img.src)).toBe(true));
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  }
});

test('Pill renders generate_image in a block-level wrapper so it starts on its own line', () => {
  const { container } = render(
    wrap(
      <Pill row={pill({ status: 'pending' }, { argumentsJson: '{"prompt":"a fox","count":1}' })} />,
    ),
  );
  expect(container.querySelector('.image-pill-block')).not.toBeNull();
});

test('moderated reasons surface in the expanded detail', () => {
  render(
    wrap(
      <ImagePill
        row={pill(
          { status: 'completed' },
          {
            prompt: 'a fox',
            modelLabel: 'Z-Image',
            artefactIds: [],
            moderatedReasons: ['content policy'],
          },
        )}
      />,
    ),
  );
  fireEvent.click(screen.getByText(/Painted · Z-Image/));
  expect(screen.getByText(/content policy/)).toBeInTheDocument();
});
