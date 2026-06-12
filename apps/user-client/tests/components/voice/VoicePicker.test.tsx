// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetVoicePickerCacheForTests } from '../../../src/components/voice/VoicePicker.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const resolveTtsTransportMock = vi.fn();
const listTtsVoicesMock = vi.fn();

vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTtsTransport: () => resolveTtsTransportMock(),
}));

vi.mock('@chatsundere/llm-unified', () => ({
  listTtsVoices: (...args: unknown[]) => listTtsVoicesMock(...args),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STUB_TRANSPORT = {
  providerConfig: { baseUrl: 'https://api.mistral.ai/v1', routing: { kind: 'direct' } as const },
  apiKey: 'test-key',
  corsProxyUrl: null,
  corsProxyKey: null,
  offering: {} as unknown,
  ttsMeta: { displayName: 'Voxtral Mini TTS', teal: 'strip' as const },
};

const STUB_VOICES = [
  { id: 'voice-a', name: 'Adele' },
  { id: 'voice-b', name: 'Bruno' },
];

import { VoicePicker } from '../../../src/components/voice/VoicePicker.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetVoicePickerCacheForTests();
  resolveTtsTransportMock.mockResolvedValue(STUB_TRANSPORT);
  listTtsVoicesMock.mockResolvedValue(STUB_VOICES);
});

afterEach(() => {
  vi.clearAllMocks();
  _resetVoicePickerCacheForTests();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VoicePicker — happy path', () => {
  it('renders voices after picker is opened', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker label="Voice" value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Adele' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Bruno' })).toBeTruthy();
    });
  });

  it('selecting a voice calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker label="Voice" value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));

    await waitFor(() => screen.getByRole('button', { name: 'Adele' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adele' }));

    expect(onSelect).toHaveBeenCalledWith('voice-a');
  });

  it('resolves the selected voice name on the collapsed trigger (no id flash)', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker label="Voice" value="voice-a" onSelect={onSelect} />);

    // The trigger label resolves to the voice NAME without the picker being
    // opened — never the raw id.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pick voice/i })).toHaveTextContent('Adele');
    });
    expect(screen.queryByText('voice-a')).toBeNull();
  });

  it('selecting None calls onSelect with null', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker label="Voice" value="voice-a" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));

    await waitFor(() => screen.getByRole('button', { name: 'None' }));
    fireEvent.click(screen.getByRole('button', { name: 'None' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('VoicePicker — error state', () => {
  it('shows error note when listTtsVoices fails', async () => {
    listTtsVoicesMock.mockRejectedValue(new Error('network error'));

    const onSelect = vi.fn();
    render(<VoicePicker label="Voice" value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't load the voice list/i)).toBeTruthy();
    });
  });

  it('Retry clears the cache and refetches voices', async () => {
    // First call fails, second succeeds.
    listTtsVoicesMock.mockRejectedValueOnce(new Error('network error'));
    listTtsVoicesMock.mockResolvedValue(STUB_VOICES);

    const onSelect = vi.fn();
    render(<VoicePicker label="Voice" value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));
    await waitFor(() => screen.getByText(/couldn't load the voice list/i));

    // Click Retry.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Adele' })).toBeTruthy();
    });
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(2);
  });
});

describe('VoicePicker — no provider', () => {
  it('renders disabled with hint when resolveTtsTransport returns null', async () => {
    resolveTtsTransportMock.mockResolvedValue(null);

    const onSelect = vi.fn();
    render(
      <VoicePicker
        label="Voice"
        value={null}
        onSelect={onSelect}
        disabled
        disabledHint="Add the Mistral provider in My Settings to enable voice."
      />,
    );

    expect(
      screen.getByText(/add the mistral provider in my settings to enable voice/i),
    ).toBeTruthy();
    // No picker button should be rendered when disabled.
    expect(screen.queryByRole('button', { name: /pick voice/i })).toBeNull();
  });
});
