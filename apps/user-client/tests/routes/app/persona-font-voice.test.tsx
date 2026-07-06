// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonaFontVoice } from '../../../src/routes/app/persona/font-voice.js';

// ── Shared stable persona fixture ─────────────────────────────────────────────

const BASE_PERSONA = {
  id: 'p-1',
  name: 'Sage',
  tagline: 'A wise guide',
  colour: '#c9a84c',
  font: 'serif' as 'sans' | 'serif' | 'cursive',
  instructions: 'Be wise.',
  canonicalId: 'glm-5.1',
  providerId: 'pv1',
  modelId: 'glm-4-flash',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  adultPersona: false,
  chatsundereTonality: true,
  contextWindow: null,
  libraryIds: [] as string[],
  askExpertDefault: false,
  mcpOverrides: {} as Record<string, 'on' | 'off'>,
  roleplay: false,
  narration: 'first' as const,
  greetingEnabled: false,
  greetingInstructions: '',
  voice: null,
  narratorVoice: null,
  useMemory: true,
  memoryInstructions: '',
  createdAt: 0,
  updatedAt: 0,
};

// ── Mutable mock state (configurable per test) ────────────────────────────────

const state: {
  persona: typeof BASE_PERSONA | null | undefined;
  patch: ReturnType<typeof vi.fn>;
} = {
  persona: BASE_PERSONA,
  patch: vi.fn().mockResolvedValue(undefined),
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const resolveTtsTransportMock = vi.fn();

// Mock resolveTtsTransport for BOTH the component probe and VoicePicker's internal call.
vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTtsTransport: () => resolveTtsTransportMock(),
}));

// Mock @chatsundere/llm-unified — needed by VoicePicker (listTtsVoices) and
// TtsModerationNotice's transitive dep on select-offering (listTtsOfferings).
vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({ id: 'p', displayName: 'P', baseUrl: 'x', offerings: [] }),
  getCanonical: () => undefined,
  listCanonicals: () => [],
  listOfferings: () => [],
  listTtsOfferings: () => [],
  listSttOfferings: () => [],
  availableCanonicals: () => ({ available: [], hiddenCount: 0 }),
  effectiveFreedom: () => 'free',
  listTtsVoices: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: (_id: string | null) => ({
    persona: state.persona,
    patch: state.patch,
  }),
}));

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

// TtsModerationNotice deps — no TTS offering active in tests → renders null.
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { ttsOffering: null } }),
}));

vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
}));

// Reset the VoicePicker session cache between tests so each test gets a clean slate.
import { _resetVoicePickerCacheForTests } from '../../../src/components/voice/VoicePicker.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetVoicePickerCacheForTests();
  // Default: no TTS provider → pickers render disabled.
  resolveTtsTransportMock.mockResolvedValue(null);
});

// ── Render helper ─────────────────────────────────────────────────────────────

function renderPage(personaId: string) {
  state.patch = vi.fn().mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/persona/${personaId}/font-voice`]}>
        <Routes>
          <Route path="/app/persona/:id/font-voice" element={<PersonaFontVoice />} />
          <Route
            path="/app/persona/:id"
            element={<div data-testid="persona-hub-sentinel">hub</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PersonaFontVoice — not-found guard', () => {
  it('renders the not-found notice when persona is null', async () => {
    state.persona = null;
    renderPage('p-missing');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());
    expect(screen.getByText(/persona not found/i)).toBeInTheDocument();
  });
});

describe('PersonaFontVoice — loading guard', () => {
  it('renders an empty shell when persona is undefined', async () => {
    state.persona = undefined;
    renderPage('p-loading');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());
    // No font options visible while loading.
    expect(screen.queryByRole('tab', { name: /sans/i })).toBeNull();
  });
});

describe('PersonaFontVoice — Font selector', () => {
  it('renders three font tabs: Sans, Serif, Cursive', async () => {
    state.persona = { ...BASE_PERSONA, font: 'serif' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: /sans/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /serif/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /cursive/i })).toBeInTheDocument();
  });

  it('marks the current font tab as selected', async () => {
    state.persona = { ...BASE_PERSONA, font: 'cursive' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: /cursive/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /sans/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /serif/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls patch with { font: "sans" } when the Sans tab is clicked', async () => {
    state.persona = { ...BASE_PERSONA, font: 'serif' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /sans/i }));

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ font: 'sans' }));
  });

  it('calls patch with { font: "cursive" } when the Cursive tab is clicked', async () => {
    state.persona = { ...BASE_PERSONA, font: 'serif' };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /cursive/i }));

    await waitFor(() => expect(state.patch).toHaveBeenCalledWith({ font: 'cursive' }));
  });

  it('shows the "Font is the persona\'s visual voice" note', async () => {
    state.persona = { ...BASE_PERSONA };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    expect(screen.getByText(/font is the persona's visual voice/i)).toBeInTheDocument();
  });
});

describe('PersonaFontVoice — Voice picker (no TTS provider)', () => {
  it('shows the disabled hint when resolveTtsTransport resolves null', async () => {
    resolveTtsTransportMock.mockResolvedValue(null);
    state.persona = { ...BASE_PERSONA };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    // The probe resolves asynchronously; wait for the disabled-hint text.
    await waitFor(() => {
      expect(
        screen.getAllByText(/add a voice provider \(xai or nano-gpt\)/i).length,
      ).toBeGreaterThanOrEqual(1);
    });

    // The picker button (aria-label "Pick Voice") must NOT be present — replaced by the hint.
    expect(screen.queryByRole('button', { name: /pick voice/i })).toBeNull();
  });
});

describe('PersonaFontVoice — Voice picker (TTS provider present)', () => {
  it('renders the Voice pick button when a TTS provider is configured', async () => {
    resolveTtsTransportMock.mockResolvedValue({
      providerConfig: { baseUrl: 'https://example.com', routing: { kind: 'direct' as const } },
      apiKey: 'key',
      offering: { providerId: 'xai', upstreamSlug: 'grok-tts' },
      ttsMeta: { displayName: 'Grok TTS', voices: { kind: 'static', list: [] } },
    });
    state.persona = { ...BASE_PERSONA, voice: null };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    // Wait for the probe to resolve and picker to become enabled.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pick voice/i })).toBeInTheDocument();
    });
  });
});

describe('PersonaFontVoice — Narrator voice picker (roleplay gating)', () => {
  it('does NOT render the Narrator voice picker when roleplay is off', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    expect(screen.queryByText(/^narrator voice$/i)).toBeNull();
  });

  it('renders the Narrator voice picker when roleplay is on', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    // The label text "Narrator voice" from VoicePicker's label prop.
    expect(screen.getByText(/^narrator voice$/i)).toBeInTheDocument();
  });

  it('shows the narrator note when roleplay is on', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: true };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    // The note spans <em>asterisk narration</em> — check the container's full text.
    const container = screen.getByTestId('persona-font-voice');
    expect(container).toHaveTextContent(/defaults to the main voice/i);
  });

  it('hides the narrator note when roleplay is off', async () => {
    state.persona = { ...BASE_PERSONA, roleplay: false };
    renderPage('p-1');

    await waitFor(() => expect(screen.getByTestId('persona-font-voice')).toBeInTheDocument());

    const container = screen.getByTestId('persona-font-voice');
    expect(container).not.toHaveTextContent(/defaults to the main voice/i);
  });
});
