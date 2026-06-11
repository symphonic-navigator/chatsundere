// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Stable reference objects (prevent infinite re-render from useMemo deps) ─

const STABLE_SETTINGS = { data: { defaultMindspaceId: 'a', userTexture: 'cloudy' as const } };
const STABLE_MINDSPACES = {
  data: [
    {
      id: 'a',
      displayName: 'Aurum',
      palette: {
        bg: '#000',
        surfaceBase: 'x',
        surfaceRaised: 'x',
        surfaceInput: 'x',
        accent: '#c9a84c',
        accentSubtle: 'x',
        accentBorder: 'x',
        accentBorderActive: 'x',
        accentGlow: 'x',
        text: { primary: '#fff', secondary: 'x', muted: 'x', ghost: 'x' },
      },
      texture: 'cloudy' as const,
      builtIn: true,
      createdAt: 0,
    },
  ],
};
const STABLE_PROVIDERS = { data: [{ id: 'pr-1', templateId: 'nano-gpt', enabled: true }] };

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Reset cache between tests so each test gets a fresh picker.
import { _resetVoicePickerCacheForTests } from '../../src/components/voice/VoicePicker.js';

const resolveTtsTransportMock = vi.fn();
const listTtsVoicesMock = vi.fn();

vi.mock('../../src/lib/voice/resolve-tts.js', () => ({
  resolveTtsTransport: () => resolveTtsTransportMock(),
}));

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({ id: 'p', displayName: 'P', baseUrl: 'x', offerings: [] }),
  getCanonical: () => undefined,
  listCanonicals: () => [],
  listOfferings: () => [],
  availableCanonicals: () => ({ available: [], hiddenCount: 0 }),
  effectiveFreedom: () => 'free',
  listTtsOfferings: () => [],
  listTtsVoices: (...args: unknown[]) => listTtsVoicesMock(...args),
}));

vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: undefined }),
  useCreatePersona: () => ({ mutateAsync: vi.fn() }),
  useUpdatePersona: () => ({ mutateAsync: vi.fn() }),
  useDeletePersona: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => STABLE_SETTINGS,
}));

vi.mock('../../src/data/mindspaces.js', () => ({
  useMindspaces: () => STABLE_MINDSPACES,
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => STABLE_PROVIDERS,
}));

vi.mock('../../src/data/chats.js', () => ({
  useChats: () => ({ data: [] }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STUB_TRANSPORT = {
  providerConfig: { baseUrl: 'https://api.mistral.ai/v1', routing: { kind: 'direct' } as const },
  apiKey: 'test-key',
  corsProxyUrl: null,
  corsProxyKey: null,
  offering: {},
  ttsMeta: { displayName: 'Voxtral Mini TTS', teal: 'strip' as const },
};

const STUB_VOICES = [{ id: 'voice-fable', name: 'Fable' }];

import { PersonaEditor } from '../../src/routes/app/persona-editor.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

function setup(path = '/app/persona/new') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/persona/:id" element={<PersonaEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openFontAndVoiceAccordion() {
  const header = await screen.findByText(/^font and voice$/i);
  fireEvent.click(header);
}

async function openBehaviourAccordion() {
  const header = await screen.findByText(/^behavior$/i);
  fireEvent.click(header);
}

beforeEach(() => {
  _resetVoicePickerCacheForTests();
  resolveTtsTransportMock.mockResolvedValue(STUB_TRANSPORT);
  listTtsVoicesMock.mockResolvedValue(STUB_VOICES);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PersonaEditor — Voice pickers disabled without TTS provider', () => {
  it('shows disabled hint on Voice picker when resolveTtsTransport resolves null', async () => {
    resolveTtsTransportMock.mockResolvedValue(null);
    setup();
    await openFontAndVoiceAccordion();
    // The disabled hint replaces the open button — wait for the probe effect to settle.
    await waitFor(() => {
      expect(screen.getByText(/add the mistral provider/i)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /pick voice/i })).toBeNull();
  });
});

describe('PersonaEditor — Voice pickers', () => {
  it('renders the Voice picker inside Font and Voice section', async () => {
    setup();
    await openFontAndVoiceAccordion();
    const voiceLabel = await screen.findByText(/^voice$/i);
    expect(voiceLabel).toBeTruthy();
  });

  it('Narrator voice picker is NOT present when roleplay is off', async () => {
    setup();
    await openFontAndVoiceAccordion();
    await screen.findByText(/^voice$/i);
    // Narrator voice should not be in the DOM.
    expect(screen.queryByText(/^narrator voice$/i)).toBeNull();
  });

  it('Narrator voice picker appears when roleplay is enabled', async () => {
    setup();

    // Enable roleplay first.
    await openBehaviourAccordion();
    const roleplayToggle = await screen.findByRole('button', { name: /^roleplay$/i });
    fireEvent.click(roleplayToggle);

    // Open Font and Voice.
    await openFontAndVoiceAccordion();

    const narratorLabel = await screen.findByText(/^narrator voice$/i);
    expect(narratorLabel).toBeTruthy();
  });

  it('Narrator voice picker disappears when roleplay is turned off again', async () => {
    setup();

    // Open Behavior and turn roleplay on.
    await openBehaviourAccordion();
    const roleplayToggle = await screen.findByRole('button', { name: /^roleplay$/i });
    fireEvent.click(roleplayToggle);
    expect(roleplayToggle).toHaveAttribute('aria-pressed', 'true');

    // Open Font and Voice — narrator picker should be present.
    await openFontAndVoiceAccordion();
    expect(await screen.findByText(/^narrator voice$/i)).toBeTruthy();

    // Turn roleplay off — Behavior is still open from before; just click the toggle.
    fireEvent.click(roleplayToggle);
    expect(roleplayToggle).toHaveAttribute('aria-pressed', 'false');

    // Narrator picker gone.
    await waitFor(() => {
      expect(screen.queryByText(/^narrator voice$/i)).toBeNull();
    });
  });
});
