// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
import { currentFloorOwner } from '../../../src/lib/media/media-floor.js';
import type { MediaItem } from '../../../src/mcp/media-items.js';

const m = vi.hoisted(() => ({
  saveMedia: vi.fn(),
  join: vi.fn((): Promise<unknown> | null => null),
  patch: vi.fn(async () => true),
}));

vi.mock('../../../src/lib/media/media-save.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/media/media-save.js')>()),
  saveMedia: m.saveMedia,
  awaitInFlightSave: m.join,
}));
vi.mock('../../../src/data/media-artefacts.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/media-artefacts.js')>()),
  patchMediaPillItem: m.patch,
}));

// JSDOM's structuredClone drops Blob fields, which fake-indexeddb relies on;
// re-attach them so a row's bytes survive the write (as in ImagePill.test.tsx).
// Each read hands out a fresh Blob of the same bytes, as real IndexedDB does.
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
        const blob = source[key];
        if (blob instanceof Blob) target[key] = blob.slice(0, blob.size, blob.type);
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
  m.join.mockReset();
  m.join.mockReturnValue(null);
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

function renderCard(
  media: MediaItem[],
  opts: { personaId?: string | null; pill?: PillRow } = {},
): { client: QueryClient; unmount: () => void } {
  const client = new QueryClient();
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MediaCard
          pill={opts.pill ?? pillWith(media)}
          chatId="c1"
          personaId={opts.personaId === undefined ? 'pe1' : opts.personaId}
          serverLabel="ElevenLabs"
          toolName="creative_generate_in_flow"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, unmount };
}

const inlineSaving = (over: Partial<MediaItem> = {}): MediaItem => ({
  key: 'bytes:abc:12',
  kind: 'audio',
  mime: 'audio/mpeg',
  title: 'Audio 1',
  status: 'saving',
  ...over,
});

const failedUrl = (over: Partial<MediaItem> = {}): MediaItem => ({
  key: 'url:https://cdn.example/x.mp3',
  kind: 'audio',
  mime: 'audio/mpeg',
  title: 'Audio 1',
  status: 'failed',
  cause: 'unreachable',
  source: { url: 'https://cdn.example/x.mp3', expiresAt: FUTURE },
  ...over,
});

/** The visible text a disabled control points at as its reason. */
function reasonOf(el: HTMLElement): string {
  const ids = el.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
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
      expect(reasonOf(button)).toBe('The link has expired, so the file could not be saved.');
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

  it('shows the marker, not a second player, for a save another result started', async () => {
    m.saveMedia.mockResolvedValue({ status: 'duplicate', artefactId: 'a5', joined: true });
    renderCard([
      {
        key: 'gen:g1',
        kind: 'video',
        mime: 'video/mp4',
        title: 'Video 1',
        status: 'saving',
        source: { url: 'https://cdn.example/v.mp4', expiresAt: FUTURE },
        owner: 'result-b',
      },
    ]);
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith('pill-1', 'gen:g1', {
        status: 'duplicate',
        artefactId: 'a5',
      }),
    );
    expect(m.saveMedia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ owner: 'result-b' }),
    );
    expect(await screen.findByRole('button', { name: 'Same 1 file as above' })).toBeTruthy();
  });

  it('joins a save of inline bytes still in flight and settles it from its outcome', async () => {
    let finish: (o: unknown) => void = () => undefined;
    m.join.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    renderCard([inlineSaving()]);
    expect(screen.getByText('Saving audio…')).toBeTruthy();
    await waitFor(() => expect(m.join).toHaveBeenCalledWith('c1', 'bytes:abc:12', undefined));
    finish({ status: 'duplicate', artefactId: 'a7' });
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith('pill-1', 'bytes:abc:12', {
        status: 'saved',
        artefactId: 'a7',
      }),
    );
    expect(m.saveMedia).not.toHaveBeenCalled();
  });

  it('settles inline bytes already saved by their key', async () => {
    await seed('a1', 'audio', {
      mediaMeta: {
        key: 'bytes:abc:12',
        durationMs: 46_000,
        serverName: 'ElevenLabs',
        toolName: 't',
      },
    });
    renderCard([inlineSaving()]);
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith('pill-1', 'bytes:abc:12', {
        status: 'saved',
        artefactId: 'a1',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Play Audio 1' })).toBeTruthy();
  });

  it('fails inline bytes that are neither saved nor still saving', async () => {
    renderCard([inlineSaving()]);
    await waitFor(() =>
      expect(m.patch).toHaveBeenCalledWith('pill-1', 'bytes:abc:12', {
        status: 'failed',
        cause: 'unreachable',
      }),
    );
    expect(await screen.findByText("Couldn't reach the file.")).toBeTruthy();
  });

  it('greys out Try again for a file too large, with the reason in view', () => {
    renderCard([failedUrl({ cause: 'too-large' })]);
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(retry)).toBe('This file is too large to save.');
    fireEvent.click(retry);
    expect(m.saveMedia).not.toHaveBeenCalled();
    // The original can still be opened where it lives.
    const open = screen.getByRole('button', { name: 'Open original' });
    expect(open.getAttribute('aria-disabled')).toBeNull();
  });

  it('says why Try again is greyed out when the file cannot be fetched again', () => {
    renderCard([failedUrl()], { personaId: null });
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText("This file can't be fetched again.")).toBeTruthy();
    expect(reasonOf(retry)).toBe("This file can't be fetched again.");
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
    const marker = screen.getByRole('button', { name: 'Same 2 files as above' });
    expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
    // Nothing earlier in this chat to scroll to: greyed out with the reason.
    expect(marker.getAttribute('aria-disabled')).toBe('true');
    expect(marker.getAttribute('title')).toBe('The earlier files are no longer in this chat.');
    expect(screen.getByText('The earlier files are no longer in this chat.')).toBeTruthy();
    expect(reasonOf(marker)).toBe('The earlier files are no longer in this chat.');
  });

  it('finds an earlier card that is still settling', async () => {
    vi.spyOn(getClientDataDb().artefacts, 'get').mockReturnValue(
      new Promise(() => undefined) as never,
    );
    renderCard([saved(1, 'a1')], { pill: { ...pillWith([saved(1, 'a1')]), id: 'pill-0' } });
    renderCard([{ ...saved(1, 'a1'), status: 'duplicate' }]);
    const marker = screen.getByRole('button', { name: 'Same 1 file as above' });
    await waitFor(() => expect(marker.getAttribute('aria-disabled')).toBeNull());
    expect(screen.queryByText('The earlier files are no longer in this chat.')).toBeNull();
  });

  it('finds an earlier card that is still saving', async () => {
    m.join.mockReturnValue(new Promise(() => undefined));
    renderCard([inlineSaving({ artefactId: 'a1' })], {
      pill: { ...pillWith([inlineSaving({ artefactId: 'a1' })]), id: 'pill-0' },
    });
    renderCard([{ ...saved(1, 'a1'), status: 'duplicate' }]);
    const marker = screen.getByRole('button', { name: 'Same 1 file as above' });
    await waitFor(() => expect(marker.getAttribute('aria-disabled')).toBeNull());
  });

  it('enables the duplicate marker once the earlier player is on the page', async () => {
    const earlier = document.createElement('div');
    earlier.dataset.mediaArtefact = 'a1';
    earlier.scrollIntoView = vi.fn();
    document.body.appendChild(earlier);
    try {
      renderCard([{ ...saved(1, 'a1'), status: 'duplicate' }]);
      const marker = screen.getByRole('button', { name: 'Same 1 file as above' });
      await waitFor(() => expect(marker.getAttribute('aria-disabled')).toBeNull());
      fireEvent.click(marker);
      expect(earlier.scrollIntoView).toHaveBeenCalled();
    } finally {
      earlier.remove();
    }
  });

  it('keeps the same source and playing state when the artefact queries refetch', async () => {
    let n = 0;
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++n}`);
    await seed('a1', 'audio');
    const { client } = renderCard([saved(1, 'a1')]);
    await screen.findByRole('button', { name: 'Play Audio 1' });
    const el = document.querySelector<HTMLAudioElement>('[data-media-element="a1"]');
    await waitFor(() => expect(el?.getAttribute('src')).toBeTruthy());
    const src = el?.getAttribute('src');
    fireEvent.click(screen.getByRole('button', { name: 'Play Audio 1' }));
    if (el) fireEvent.play(el);
    expect(await screen.findByRole('button', { name: 'Pause Audio 1' })).toBeTruthy();
    const before = created.mock.calls.length;

    await client.invalidateQueries({ queryKey: ['artefacts'] });
    await new Promise((r) => setTimeout(r, 20));

    expect(el?.getAttribute('src')).toBe(src);
    expect(created.mock.calls.length).toBe(before);
    expect(screen.getByRole('button', { name: 'Pause Audio 1' })).toBeTruthy();
  });

  it('gives the floor back on pause, on end, on a reset source and on unmount', async () => {
    await seed('a1', 'audio');
    const { unmount } = renderCard([saved(1, 'a1')]);
    const play = await screen.findByRole('button', { name: 'Play Audio 1' });
    const el = document.querySelector<HTMLAudioElement>('[data-media-element="a1"]');
    await waitFor(() => expect(el?.getAttribute('src')).toBeTruthy());
    if (!el) throw new Error('no element');

    for (const stop of [fireEvent.pause, fireEvent.ended, fireEvent.emptied, fireEvent.abort]) {
      fireEvent.click(play);
      fireEvent.play(el);
      expect(currentFloorOwner()).toMatch(/^player:a1:/);
      stop(el);
      expect(currentFloorOwner()).toBeNull();
      expect(screen.getByRole('button', { name: 'Play Audio 1' })).toBeTruthy();
    }

    fireEvent.click(play);
    fireEvent.play(el);
    expect(currentFloorOwner()).toMatch(/^player:a1:/);
    unmount();
    expect(currentFloorOwner()).toBeNull();
  });

  it('keeps one player of an artefact on the floor when another of it unmounts', async () => {
    await seed('a1', 'audio');
    renderCard([saved(1, 'a1')]);
    const second = renderCard([saved(1, 'a1')]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Play Audio 1' })).toHaveLength(2),
    );
    const [el1, el2] = [
      ...document.querySelectorAll<HTMLAudioElement>('[data-media-element="a1"]'),
    ];
    if (!el1 || !el2) throw new Error('no elements');
    await waitFor(() => {
      expect(el1.getAttribute('src')).toBeTruthy();
      expect(el2.getAttribute('src')).toBeTruthy();
    });
    const [play1, play2] = screen.getAllByRole('button', { name: 'Play Audio 1' });
    if (!play1 || !play2) throw new Error('no buttons');
    fireEvent.click(play2);
    fireEvent.play(el2);
    fireEvent.click(play1);
    fireEvent.play(el1);
    // The other instance of the same artefact is paused, not left playing beside it.
    expect(paused).toContain(el2);
    const first = currentFloorOwner();
    expect(first).toMatch(/^player:a1:/);
    second.unmount();
    expect(currentFloorOwner()).toBe(first);
  });

  it('shows the provider and the note for a result whose files were all refused', () => {
    const pill = pillWith([]);
    pill.payload = { ...(pill.payload as object), mediaRefused: 2 };
    renderCard([], { pill });
    expect(screen.getByText('ElevenLabs · creative_generate_in_flow')).toBeTruthy();
    expect(screen.getByText('2 files not shown: unsupported type')).toBeTruthy();
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
  it('renders the card under the pill for a refused-only result', async () => {
    const row = pillWith([]);
    row.payload = { ...(row.payload as object), mediaRefused: 1 };
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Pill row={row} chatId="c1" personaId="pe1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelector('.media-card-block')).toBeTruthy();
    expect(await screen.findByText('1 file not shown: unsupported type')).toBeTruthy();
  });

  it('opens the file itself in the Treasury', async () => {
    await seed('a1', 'audio');
    function Where(): JSX.Element {
      const loc = useLocation();
      return <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/app/chat/c1']}>
          <Routes>
            <Route
              path="/app/chat/c1"
              element={
                <MediaCard
                  pill={pillWith([saved(1, 'a1')])}
                  chatId="c1"
                  personaId="pe1"
                  serverLabel="ElevenLabs"
                  toolName="creative_generate_in_flow"
                />
              }
            />
            <Route path="/app/treasury" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'More for Audio 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in Treasury' }));
    expect(screen.getByTestId('where').textContent).toBe('/app/treasury?type=media&open=a1');
  });
});
