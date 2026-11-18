// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Two-level return chain (spec 0.5.0 papercuts, "The return convention"):
// chat → Font & Voice → Settings → Voice → Back → Back lands on the chat.

const persona = {
  id: 'p-1',
  name: 'Sage',
  font: 'serif',
  roleplay: false,
  voice: null,
  narratorVoice: null,
};

vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  VOICES_UNAVAILABLE_COPY: "Couldn't load your ElevenLabs voices — tap to try again.",
  resolveTtsTransport: () =>
    Promise.resolve({
      providerConfig: {},
      apiKey: 'k',
      offering: { providerId: 'elevenlabs', upstreamSlug: 'eleven_v4' },
      ttsMeta: { displayName: 'Eleven v4', voices: { kind: 'static', voices: [] } },
    }),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: () => ({ displayName: 'ElevenLabs' }),
}));
vi.mock('../../../src/routes/app/persona/use-persona-editing.js', () => ({
  usePersonaEditing: () => ({ persona, patch: vi.fn() }),
}));
vi.mock('../../../src/components/voice/VoicePicker.js', () => ({
  VoicePicker: () => <div data-testid="voice-picker" />,
}));
vi.mock('../../../src/components/voice/TtsModerationNotice.js', () => ({
  TtsModerationNotice: () => null,
}));
vi.mock('../../../src/components/voice/VoiceSection.js', () => ({
  VoiceSection: () => <div data-testid="voice-section" />,
}));
vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { voiceRepairFor } from '../../../src/lib/voice/voice-repair.js';
import { PersonaFontVoice } from '../../../src/routes/app/persona/font-voice.js';
import { SettingsVoicePage } from '../../../src/routes/app/settings/voice.js';

/** Stands in for the chat: the cockpit's no-voice note link, built the same way. */
function ChatStandIn(): JSX.Element {
  const l = useLocation();
  const fix = voiceRepairFor('no-voice', 'p-1', `${l.pathname}${l.search}`);
  return <div data-testid="chat">{fix ? <Link to={fix.to}>{fix.label}</Link> : null}</div>;
}

describe('return chain: chat → Font & Voice → Settings → Voice', () => {
  it('Back, Back unwinds to Font & Voice, then the chat', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app/chat/c1']}>
          <Routes>
            <Route path="/app/chat/:chatId" element={<ChatStandIn />} />
            <Route path="/app/persona/:id/font-voice" element={<PersonaFontVoice />} />
            <Route path="/app/settings/voice" element={<SettingsVoicePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Choose a voice' }));
    fireEvent.click(await screen.findByRole('link', { name: 'change in My Settings → Voice' }));
    expect(screen.getByTestId('voice-section')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByTestId('persona-font-voice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByTestId('chat')).toBeInTheDocument();
  });
});
