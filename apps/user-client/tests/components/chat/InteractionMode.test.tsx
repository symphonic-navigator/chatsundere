// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import type { PersonaRow } from '../../../src/boot/client-data-db.js';
import { InteractionMode } from '../../../src/components/chat/InteractionMode.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';
import { DESKTOP_MEDIA_QUERY } from '../../../src/state/effective-chat-mode.js';
import { idleDictationStub } from '../../helpers/dictation-stub.js';

type ChangeListener = () => void;

/** Replaces window.matchMedia with a controllable stub; returns a flip switch. */
function installMatchMedia(initialMatches: boolean): { setMatches: (next: boolean) => void } {
  const listeners = new Set<ChangeListener>();
  let matches = initialMatches;
  const mql = {
    get matches() {
      return matches;
    },
    media: DESKTOP_MEDIA_QUERY,
    onchange: null,
    addEventListener: (_type: string, cb: ChangeListener) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: ChangeListener) => {
      listeners.delete(cb);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) cb();
    },
  };
}

const originalMatchMedia = window.matchMedia;

beforeEach(async () => {
  useCurrentChatStore.getState().reset();
  useCurrentChatStore.getState().setInteractionMode(true);
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

// The gauge text is contextUtilisation(usedTokens, window). With usedTokens
// = window/2 the gauge must read 50% — proving `window` is the resolved value.
it('gauge uses the resolved context window (clamped), not raw recommended', () => {
  const offering = {
    context: { recommended: 200_000, max: 1_000_000 },
    profile: { reasoning: 'none' },
  } as unknown as Offering;
  // override below the 64k floor -> resolves to 65_536
  const persona = {
    id: 'p',
    name: 'A',
    colour: '#fff',
    font: 'serif',
    contextWindow: 1_000,
    libraryIds: [],
    instructions: 'x',
    adultPersona: false,
    chatsundereTonality: true,
    tagline: '',
    canonicalId: null,
    providerId: '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as PersonaRow;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InteractionMode
          persona={persona}
          chatId="c1"
          chat={null}
          offering={offering}
          usedTokens={32_768}
          draftValue=""
          onDraftChange={() => {}}
          onSend={() => {}}
          editingMessageId={null}
          canReplace={false}
          editAttachments={[]}
          onReplace={() => {}}
          onBranchEdit={() => {}}
          onCancelEdit={() => {}}
          onStop={() => {}}
          isStreamLive={false}
          onExit={() => {}}
          onRenameChat={() => {}}
          onOpenPersonaEditor={() => {}}
          dictation={idleDictationStub}
          autoReadAloud={false}
          onToggleAutoRead={() => {}}
          voiceUnavailable={null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('50%')).toBeInTheDocument();
});

// Shared fixtures and the `renderInteractionMode()` helper below back every
// test from here on — the first test above predates the helper and renders
// inline instead.
const offering = {
  context: { recommended: 200_000, max: 1_000_000 },
  profile: { reasoning: 'none' },
} as unknown as Offering;
const persona = {
  id: 'p',
  name: 'A',
  colour: '#fff',
  font: 'serif',
  contextWindow: 1_000,
  libraryIds: [],
  instructions: 'x',
  adultPersona: false,
  chatsundereTonality: true,
  tagline: '',
  canonicalId: null,
  providerId: '',
  modelId: '',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  createdAt: 1,
  updatedAt: 1,
} as unknown as PersonaRow;

function renderInteractionMode(
  overrides: Partial<ComponentProps<typeof InteractionMode>> = {},
): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InteractionMode
          persona={persona}
          chatId="c1"
          chat={null}
          offering={offering}
          usedTokens={32_768}
          draftValue=""
          onDraftChange={() => {}}
          onSend={() => {}}
          editingMessageId={null}
          canReplace={false}
          editAttachments={[]}
          onReplace={() => {}}
          onBranchEdit={() => {}}
          onCancelEdit={() => {}}
          onStop={() => {}}
          isStreamLive={false}
          onExit={() => {}}
          onRenameChat={() => {}}
          onOpenPersonaEditor={() => {}}
          dictation={idleDictationStub}
          autoReadAloud={false}
          onToggleAutoRead={() => {}}
          voiceUnavailable={null}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('hides the pin control on desktop — nothing to toggle in the single mode', () => {
  installMatchMedia(true);
  renderInteractionMode();
  expect(document.querySelector('[data-control="pin"]')).toBeNull();
});

it('shows the pin control on mobile (guard)', () => {
  installMatchMedia(false);
  renderInteractionMode();
  expect(document.querySelector('[data-control="pin"]')).not.toBeNull();
});

it('does not close on an outside tap on desktop (pinned semantics, spec §7.5)', () => {
  installMatchMedia(true);
  renderInteractionMode();
  // The file's beforeEach sets isInteractionMode true; an outside pointerdown
  // must NOT flip it back on desktop (the unpinned auto-close is mobile-only).
  fireEvent.pointerDown(document.body);
  expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
});

it('mounts the topbar without a cockpit when no offering resolves (spec §5.6)', () => {
  installMatchMedia(false);
  renderInteractionMode({ offering: null });
  // The repair path stays reachable: exit + persona avatar are in the topbar.
  expect(screen.getByLabelText('Exit to Entrance Hall')).toBeInTheDocument();
  // No model — no composer.
  expect(document.querySelector('.cockpit-focus-capture')).toBeNull();
  // The gauge degrades to an explicit unavailable state, not a fake 0 %.
  expect(screen.getByText('—')).toBeInTheDocument();
});
