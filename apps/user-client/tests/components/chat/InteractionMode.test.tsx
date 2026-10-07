// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import type { PersonaRow } from '../../../src/boot/client-data-db.js';
import { ChatQuickMenu, anchorFrom } from '../../../src/components/chat/ChatQuickMenu.js';
import { InteractionMode } from '../../../src/components/chat/InteractionMode.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';
import { DESKTOP_MEDIA_QUERY } from '../../../src/state/effective-chat-mode.js';
import { _resetAppUpdateForTests, useAppUpdateStore } from '../../../src/sw/app-update.store.js';
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
          resolution={{ kind: 'ok', offering }}
          onSetUpProvider={() => {}}
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
          onOpenQuickMenu={() => {}}
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
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): ReturnType<typeof render> {
  return render(interactionModeTree(overrides, qc));
}

function interactionModeTree(
  overrides: Partial<ComponentProps<typeof InteractionMode>>,
  qc: QueryClient,
): JSX.Element {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InteractionMode
          persona={persona}
          chatId="c1"
          chat={null}
          offering={offering}
          resolution={{ kind: 'ok', offering }}
          onSetUpProvider={() => {}}
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
          onOpenQuickMenu={() => {}}
          onRenameChat={() => {}}
          onOpenPersonaEditor={() => {}}
          dictation={idleDictationStub}
          autoReadAloud={false}
          onToggleAutoRead={() => {}}
          voiceUnavailable={null}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>
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
  renderInteractionMode({ offering: null, resolution: null });
  // The repair path stays reachable: quick menu + persona avatar are in the topbar.
  expect(screen.getByLabelText('Quick menu')).toBeInTheDocument();
  // No model — no composer.
  expect(document.querySelector('.cockpit-focus-capture')).toBeNull();
  // The gauge degrades to an explicit unavailable state, not a fake 0 %.
  expect(screen.getByText('—')).toBeInTheDocument();
});

it('renders the unavailable card in the cockpit slot when the model is unknown (incident regression)', () => {
  installMatchMedia(false);
  _resetAppUpdateForTests();
  // Never settles, so the card's mount-time check lands no state update after the test.
  useAppUpdateStore.getState().bind({
    apply: vi.fn(() => true),
    check: () => new Promise<'none'>(() => {}),
    peek: () => 'none',
  });
  renderInteractionMode({
    offering: null,
    resolution: { kind: 'model-unknown', templateId: 'nano-gpt', modelId: 'x/y' },
  });
  expect(document.querySelector('.cockpit-unavailable')).not.toBeNull();
  expect(document.querySelector('.cockpit-focus-capture')).toBeNull();
});

it('renders neither cockpit nor card while the resolution is still loading', () => {
  installMatchMedia(false);
  renderInteractionMode({ offering: null, resolution: null });
  expect(document.querySelector('textarea')).toBeNull();
  expect(document.querySelector('.cockpit-unavailable')).toBeNull();
});

it('remounts the card with a fresh update check when the unresolved model changes', () => {
  installMatchMedia(false);
  _resetAppUpdateForTests();
  // Never settles, so the card stays in its checking row without late state updates.
  const check = vi.fn(() => new Promise<'none'>(() => {}));
  useAppUpdateStore.getState().bind({ apply: vi.fn(() => true), check, peek: () => 'none' });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = {
    offering: null,
    resolution: { kind: 'model-unknown', templateId: 'nano-gpt', modelId: 'x/y' },
  } as const;
  const { rerender } = renderInteractionMode(first, qc);
  expect(check).toHaveBeenCalledTimes(1);
  rerender(
    interactionModeTree(
      {
        offering: null,
        resolution: { kind: 'model-unknown', templateId: 'nano-gpt', modelId: 'a/b' },
      },
      qc,
    ),
  );
  expect(check).toHaveBeenCalledTimes(2);
  _resetAppUpdateForTests();
});

it('a tap inside the quick menu does not collapse an unpinned cockpit (spec §3.5)', () => {
  installMatchMedia(false);
  renderInteractionMode();
  const root = document.createElement('div');
  root.className = 'chat-quick-menu-root';
  const entry = document.createElement('button');
  root.appendChild(entry);
  document.body.appendChild(root);
  const onClick = vi.fn();
  entry.addEventListener('click', onClick);

  fireEvent.pointerDown(entry);
  fireEvent.click(entry);

  expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
  expect(onClick).toHaveBeenCalledTimes(1);
  root.remove();
});

it('Escape with the quick menu open closes only the menu, not the cockpit', () => {
  installMatchMedia(false);
  function StoreWiredMenu(): JSX.Element {
    const anchor = useCurrentChatStore((s) => s.quickMenuAnchor);
    const close = useCurrentChatStore((s) => s.closeQuickMenu);
    return (
      <ChatQuickMenu
        anchor={anchor}
        persona={{ id: persona.id, name: persona.name, colour: persona.colour }}
        activeChatId="c1"
        returnTo="/app/chat/c1"
        onClose={close}
        onEntranceHall={() => {}}
        onNavigate={() => {}}
      />
    );
  }
  renderInteractionMode({
    onOpenQuickMenu: (trigger) => useCurrentChatStore.getState().openQuickMenu(anchorFrom(trigger)),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StoreWiredMenu />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Quick menu' }));
  expect(screen.getByRole('menu')).toBeInTheDocument();

  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

  expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
});
