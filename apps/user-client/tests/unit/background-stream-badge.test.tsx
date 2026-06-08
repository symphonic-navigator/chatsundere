import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundStreamBadge } from '../../src/components/BackgroundStreamBadge';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';
import 'fake-indexeddb/auto';
import { uuidv7 } from 'uuidv7';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';

// Hoist the navigate spy so vi.mock can close over it before module evaluation.
const navSpy = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useNavigate: () => navSpy };
});

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useStreamManagerStore.setState({ streams: new Map() });
  navSpy.mockClear();
});

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(ui: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? makeQc();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function plant(streams: Array<{ chatId: string; personaId: string }>): void {
  const map = new Map();
  let i = 0;
  for (const s of streams) {
    map.set(s.chatId, {
      chatId: s.chatId,
      personaId: s.personaId,
      draftMessageId: `d-${i++}`,
      controller: new AbortController(),
      status: 'streaming' as const,
      contentBuffer: [],
      pillBuffer: [],
      startedAt: Date.now() + i,
      reusedDraft: false,
    });
  }
  useStreamManagerStore.setState({ streams: map });
}

describe('BackgroundStreamBadge', () => {
  it('renders nothing when no streams', () => {
    const { container } = wrap(<BackgroundStreamBadge />);
    expect(container.querySelector('.bg-stream-badge')).toBeNull();
  });

  it('single stream shows persona initial', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Aurum',
      tagline: '',
      colour: '#c9a84c',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: 'pr',
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
      createdAt: 1,
      updatedAt: 1,
    });
    plant([{ chatId: 'c1', personaId }]);
    const { container, findByText } = wrap(<BackgroundStreamBadge />);
    await findByText('A');
    expect(container.querySelector('.bg-stream-badge')).not.toBeNull();
  });

  it('multiple streams show count', () => {
    plant([
      { chatId: 'c1', personaId: 'p1' },
      { chatId: 'c2', personaId: 'p2' },
    ]);
    const { container } = wrap(<BackgroundStreamBadge />);
    const badge = container.querySelector('.bg-stream-badge');
    expect(badge?.textContent).toContain('2');
  });

  it('tap navigates to oldest stream', () => {
    plant([
      { chatId: 'newer', personaId: 'p1' },
      { chatId: 'oldest', personaId: 'p2' },
    ]);
    // Re-jiggle so 'oldest' actually has the smallest startedAt.
    useStreamManagerStore.setState((s) => {
      const m = new Map(s.streams);
      const newer = m.get('newer');
      const oldest = m.get('oldest');
      if (newer && oldest) {
        m.set('newer', { ...newer, startedAt: 2000 });
        m.set('oldest', { ...oldest, startedAt: 1000 });
      }
      return { streams: m };
    });
    const { container } = wrap(<BackgroundStreamBadge />);
    fireEvent.click(container.querySelector('.bg-stream-badge') as HTMLButtonElement);
    expect(navSpy).toHaveBeenCalledWith('/app/chat/oldest');
  });
});
