// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  type ArtefactRow,
  type PillRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { Pill } from '../../../src/components/chat/Pill.js';
import { MediaCard } from '../../../src/components/chat/media/MediaCard.js';
import type { MediaItem } from '../../../src/mcp/media-items.js';

const m = vi.hoisted(() => ({
  saveMedia: vi.fn(),
  patch: vi.fn(async () => true),
}));

vi.mock('../../../src/lib/media/media-save.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/media/media-save.js')>()),
  saveMedia: m.saveMedia,
}));
vi.mock('../../../src/data/media-artefacts.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/media-artefacts.js')>()),
  patchMediaPillItem: m.patch,
}));

// JSDOM's structuredClone drops Blob fields, which fake-indexeddb relies on;
// re-attach them so a row's bytes survive the write (as in ImagePill.test.tsx).
{
  const orig = globalThis.structuredClone;
  globalThis.structuredClone = function blobPreservingClone<T>(
    value: T,
    opts?: StructuredSerializeOptions,
  ): T {
    const cloned = orig(value, opts);
    if (value && typeof value === 'object' && !(value instanceof Blob)) {
      const source = value as Record<string, unknown>;
      const target = cloned as Record<string, unknown>;
      for (const key of Object.keys(source)) {
        if (source[key] instanceof Blob) target[key] = source[key];
      }
    }
    return cloned;
  } as typeof structuredClone;
}

const FUTURE = Date.now() + 3_600_000;
const PAST = Date.now() - 60_000;

let paused: HTMLMediaElement[] = [];

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  m.saveMedia.mockReset();
  m.patch.mockClear();
  paused = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused.push(this);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await _resetClientDataDbForTests();
});

function pillWith(media: MediaItem[]): PillRow {
  return {
    id: 'pill-1',
    messageId: 'msg-1',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'completed',
    payload: { name: 'elevenlabs_creative_generate_in_flow', result: 'ok', media },
    createdAt: 1,
  };
}

async function seed(
  id: string,
  kind: 'audio' | 'video',
  over: Partial<ArtefactRow> = {},
): Promise<void> {
  const mime = kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
  await getClientDataDb().artefacts.add({
    id,
    chatId: 'c1',
    personaId: 'pe1',
    projectId: null,
    origin: 'generated',
    kind,
    format: kind,
    title: id,
    fileName: `${id}.${kind === 'audio' ? 'mp3' : 'mp4'}`,
    mime,
    content: '',
    tags: [],
    favourite: false,
    createdAt: 1,
    updatedAt: 1,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: mime }),
    mediaMeta: { key: `gen:${id}`, durationMs: 46_000, serverName: 'ElevenLabs', toolName: 't' },
    ...over,
  });
}

function saved(n: number, artefactId: string, kind: 'audio' | 'video' = 'audio'): MediaItem {
  const label = kind === 'audio' ? 'Audio' : 'Video';
  return {
    key: `gen:${artefactId}`,
    kind,
    mime: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
    title: `${label} ${n}`,
    status: 'saved',
    artefactId,
  };
}

function renderCard(media: MediaItem[]): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MediaCard
          pill={pillWith(media)}
          chatId="c1"
          personaId="pe1"
          serverLabel="ElevenLabs"
          toolName="creative_generate_in_flow"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MediaCard', () => {
  it('shows the provider label', async () => {
    await seed('a1', 'audio');
    renderCard([saved(1, 'a1')]);
    expect(screen.getByText('ElevenLabs · creative_generate_in_flow')).toBeTruthy();
  });

  it('shows a saved audio file with its duration before play', async () => {
    await seed('a1', 'audio');
    renderCard([saved(1, 'a1')]);
    const play = await screen.findByRole('button', { name: 'Play Audio 1' });
    expect(play.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByText('0:00 / 0:46')).toBeTruthy();
    const seek = screen.getByRole('slider', { name: 'Seek Audio 1' });
    expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 0:46');
  });

  it('pauses the playing file when another one starts', async () => {
    await seed('a1', 'audio');
    await seed('a2', 'audio');
    renderCard([saved(1, 'a1'), saved(2, 'a2')]);
    const play1 = await screen.findByRole('button', { name: 'Play Audio 1' });
    const play2 = await screen.findByRole('button', { name: 'Play Audio 2' });
    await waitFor(() =>
      expect(document.querySelector('[data-media-element="a1"]')?.getAttribute('src')).toBeTruthy(),
    );
    fireEvent.click(play1);
    expect(paused).toHaveLength(0);
    fireEvent.click(play2);
    const first = document.querySelector('[data-media-element="a1"]');
    expect(paused).toContain(first);
  });

  it('offers Try again for an unreachable file and settles it as saved', async () => {
    m.saveMedia.mockResolvedValue({ status: 'saved', artefactId: 'a9' });
    renderCard([
      {
        key: 'url:https://cdn.example/x.mp3',
        kind: 'audio',
        mime: 'audio/mpeg',
        title: 'Audio 1',
        status: 'failed',
        cause: 'unreachable',
        source: { url: 'https://cdn.example/x.mp3', expiresAt: FUTURE },
      },
    ]);
    expect(screen.getByText("Couldn't reach the file.")).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(retry);
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith(
        'pill-1',
        'url:https://cdn.example/x.mp3',
        expect.objectContaining({ status: 'saved', artefactId: 'a9' }),
      ),
    );
    expect(m.saveMedia).toHaveBeenCalledTimes(1);
    const [ref, ctx] = m.saveMedia.mock.calls[0] as [
      { source: unknown; key: string },
      { chatId: string; serverName: string; toolName: string; title: string },
    ];
    expect(ref.source).toEqual({ kind: 'url', url: 'https://cdn.example/x.mp3' });
    expect(ctx).toMatchObject({
      chatId: 'c1',
      personaId: 'pe1',
      serverName: 'ElevenLabs',
      toolName: 'creative_generate_in_flow',
      title: 'Audio 1',
    });
  });

  it('greys out Try again and Open original once the link has expired', () => {
    renderCard([
      {
        key: 'url:https://cdn.example/x.mp3',
        kind: 'audio',
        mime: 'audio/mpeg',
        title: 'Audio 1',
        status: 'failed',
        cause: 'expired',
        source: { url: 'https://cdn.example/x.mp3', expiresAt: PAST },
      },
    ]);
    expect(screen.getByText('The link has expired, so the file could not be saved.')).toBeTruthy();
    for (const name of ['Try again', 'Open original']) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.getAttribute('title')).toBe('The link has expired.');
      fireEvent.click(button);
    }
    expect(m.saveMedia).not.toHaveBeenCalled();
  });

  it('joins a save still running for a saving item, and settles its own duplicate as saved', async () => {
    m.saveMedia.mockResolvedValue({ status: 'duplicate', artefactId: 'a5' });
    renderCard([
      {
        key: 'gen:g1',
        kind: 'video',
        mime: 'video/mp4',
        title: 'Video 1',
        status: 'saving',
        source: { url: 'https://cdn.example/v.mp4', expiresAt: FUTURE },
      },
    ]);
    expect(screen.getByText('Saving video…')).toBeTruthy();
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith(
        'pill-1',
        'gen:g1',
        expect.objectContaining({ status: 'saved', artefactId: 'a5' }),
      ),
    );
    expect(m.saveMedia).toHaveBeenCalledTimes(1);
  });

  it('marks an expired saving item as failed without fetching', async () => {
    renderCard([
      {
        key: 'gen:g1',
        kind: 'audio',
        mime: 'audio/mpeg',
        title: 'Audio 1',
        status: 'saving',
        source: { url: 'https://cdn.example/a.mp3', expiresAt: PAST },
      },
    ]);
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith('pill-1', 'gen:g1', {
        status: 'failed',
        cause: 'expired',
      }),
    );
    expect(m.saveMedia).not.toHaveBeenCalled();
    expect(
      await screen.findByText('The link has expired, so the file could not be saved.'),
    ).toBeTruthy();
  });

  it('explains a file that lives only on another device', async () => {
    await seed('a1', 'audio', { blob: undefined, blobOversized: true });
    renderCard([saved(1, 'a1')]);
    expect(
      await screen.findByText('This file lives only on the device that saved it.'),
    ).toBeTruthy();
    const play = screen.getByRole('button', { name: 'Play Audio 1' });
    expect(play.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Audio 1')).toBeTruthy();
    expect(screen.getByText('0:00 / 0:46')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More for Audio 1' }));
    const download = screen.getByRole('menuitem', { name: /Download/ });
    expect(download.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows one marker for files already shown above, and no player', async () => {
    renderCard([
      { ...saved(1, 'a1'), status: 'duplicate' },
      { ...saved(2, 'a2'), status: 'duplicate' },
    ]);
    expect(screen.getByRole('button', { name: 'Same 2 files as above' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
  });

  it('notes refused files', async () => {
    await seed('a1', 'audio');
    renderCard([{ ...saved(1, 'a1'), refused: 1 }]);
    expect(screen.getByText('1 file not shown: unsupported type')).toBeTruthy();
  });

  it('shows a video tile with poster, duration badge and menu', async () => {
    await seed('v1', 'video', {
      thumbBlob: new Blob([new Uint8Array([9])], { type: 'image/jpeg' }),
    });
    renderCard([saved(1, 'v1', 'video')]);
    expect(await screen.findByRole('img', { name: 'Video 1' })).toBeTruthy();
    expect(screen.getByText('0:46')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More for Video 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play Video 1' })).toBeTruthy();
    expect(document.querySelector('video')?.hasAttribute('playsinline')).toBe(true);
  });
});

describe('Pill with media', () => {
  it('renders the inline tool pill and the media card as a block after it', async () => {
    await getClientDataDb().mcpServers.add({
      id: 's1',
      name: 'ElevenLabs',
      url: 'https://mcp.elevenlabs.example/mcp',
      prefix: 'elevenlabs',
      auth: null,
      onByDefault: true,
      autoRun: true,
      enabled: true,
      allowDirect: true,
      routing: 'direct',
      resolvedEndpoint: null,
      tools: [],
      hiddenTools: [],
      lastTestedAt: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await seed('a1', 'audio');
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Pill row={pillWith([saved(1, 'a1')])} chatId="c1" personaId="pe1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('.pill-wrap .pill')).toBeTruthy();
    const block = container.querySelector('.media-card-block');
    expect(block?.previousElementSibling?.classList.contains('pill-wrap')).toBe(true);
    expect(await screen.findByText('ElevenLabs · creative_generate_in_flow')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Play Audio 1' })).toBeTruthy();
  });
});
