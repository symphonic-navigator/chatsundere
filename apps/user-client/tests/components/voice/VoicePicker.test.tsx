// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetVoiceListForTests } from '../../../src/lib/voice/voice-list.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const resolveTtsTransportMock = vi.fn();
const listTtsVoicesMock = vi.fn();

vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTtsTransport: () => resolveTtsTransportMock(),
}));

const PROVIDER_NAMES: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  mistral: 'Mistral',
  xai: 'xAI',
};

vi.mock('@chatsundere/llm-unified', () => ({
  listTtsVoices: (...args: unknown[]) => listTtsVoicesMock(...args),
  getProvider: (id: string) =>
    PROVIDER_NAMES[id] ? { id, displayName: PROVIDER_NAMES[id] } : undefined,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STUB_TRANSPORT = {
  providerConfig: { baseUrl: 'https://api.mistral.ai/v1', routing: { kind: 'direct' } as const },
  apiKey: 'test-key',
  offering: { providerId: 'mistral', upstreamSlug: 'voxtral-tts' },
  ttsMeta: {
    displayName: 'Voxtral Mini TTS',
    teal: 'strip' as const,
    voices: { kind: 'fetch' as const, endpoint: 'mistral-paginated' as const },
  },
};

const STUB_VOICES = [
  { id: 'voice-a', name: 'Adele' },
  { id: 'voice-b', name: 'Bruno' },
];

import { VoicePicker } from '../../../src/components/voice/VoicePicker.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetVoiceListForTests();
  resolveTtsTransportMock.mockResolvedValue(STUB_TRANSPORT);
  listTtsVoicesMock.mockResolvedValue({ voices: STUB_VOICES, hiddenCount: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  _resetVoiceListForTests();
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

  it('uses neutral provider wording in the error copy', async () => {
    listTtsVoicesMock.mockRejectedValue(new Error('network error'));

    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Couldn't load the voice list — check your connection and your voice provider's account.",
        ),
      ).toBeTruthy();
    });
  });

  it('Retry clears the cache and refetches voices', async () => {
    // First call fails, second succeeds.
    listTtsVoicesMock.mockRejectedValueOnce(new Error('network error'));
    listTtsVoicesMock.mockResolvedValue({ voices: STUB_VOICES, hiddenCount: 0 });

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

describe('VoicePicker — static voice list', () => {
  it("shows the offering's static list without calling listTtsVoices", async () => {
    resolveTtsTransportMock.mockResolvedValue({
      ...STUB_TRANSPORT,
      offering: { providerId: 'nano-gpt', upstreamSlug: 'xai-tts' },
      ttsMeta: {
        ...STUB_TRANSPORT.ttsMeta,
        voices: {
          kind: 'static' as const,
          list: [
            { id: 'eve', name: 'Eve' },
            { id: 'ara', name: 'Ara' },
          ],
        },
      },
    });

    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Eve' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Ara' })).toBeTruthy();
    });
    expect(listTtsVoicesMock).not.toHaveBeenCalled();
  });
});

describe('VoicePicker — per-offering memo', () => {
  it('refetches when the resolved offering changes', async () => {
    const { unmount } = render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));
    await waitFor(() => screen.getByRole('button', { name: 'Adele' }));
    expect(listTtsVoicesMock).toHaveBeenCalledTimes(1);
    unmount();

    // The slot now resolves to a different offering — the memo must not serve
    // the first offering's list for it.
    resolveTtsTransportMock.mockResolvedValue({
      ...STUB_TRANSPORT,
      offering: { providerId: 'xai', upstreamSlug: 'grok-tts' },
      ttsMeta: {
        ...STUB_TRANSPORT.ttsMeta,
        voices: { kind: 'fetch' as const, endpoint: 'xai-flat' as const },
      },
    });
    listTtsVoicesMock.mockResolvedValue({
      voices: [{ id: 'voice-c', name: 'Cleo' }],
      hiddenCount: 0,
    });

    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));
    await waitFor(() => screen.getByRole('button', { name: 'Cleo' }));
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

describe('VoicePicker — stale responses', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('a slow eager list resolving after the fresh one does not overwrite it', async () => {
    const eager = deferred<{ voices: typeof STUB_VOICES; hiddenCount: number }>();
    listTtsVoicesMock.mockReturnValueOnce(eager.promise);
    listTtsVoicesMock.mockResolvedValueOnce({
      voices: [{ id: 'voice-a', name: 'Fresh Adele' }],
      hiddenCount: 0,
    });

    render(<VoicePicker label="Voice" value="voice-a" onSelect={vi.fn()} />);
    await waitFor(() => expect(listTtsVoicesMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));
    await waitFor(() => expect(screen.getAllByText('Fresh Adele').length).toBeGreaterThan(0));

    eager.resolve({ voices: STUB_VOICES, hiddenCount: 0 });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.getAllByText('Fresh Adele').length).toBeGreaterThan(0);
    expect(screen.queryByText('Bruno')).toBeNull();
  });

  it('a late eager rejection does not replace a loaded list with the error state', async () => {
    const eager = deferred<never>();
    listTtsVoicesMock.mockReturnValueOnce(eager.promise);
    listTtsVoicesMock.mockResolvedValueOnce({ voices: STUB_VOICES, hiddenCount: 0 });

    render(<VoicePicker label="Voice" value="voice-a" onSelect={vi.fn()} />);
    await waitFor(() => expect(listTtsVoicesMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));
    await waitFor(() => screen.getByRole('button', { name: 'Bruno' }));

    eager.reject(new Error('late'));
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.getByRole('button', { name: 'Bruno' })).toBeTruthy();
    expect(screen.queryByText(/couldn.t load the voice list/i)).toBeNull();
  });
});

// ─── Search, filters, hidden count, stale hint (spec §7.1–7.2) ─────────────────

const ELEVEN_TRANSPORT = {
  ...STUB_TRANSPORT,
  providerConfig: { baseUrl: 'https://api.elevenlabs.io', routing: { kind: 'direct' } as const },
  offering: { providerId: 'elevenlabs', upstreamSlug: 'eleven_v4' },
  ttsMeta: {
    displayName: 'Eleven v4',
    teal: 'strip' as const,
    voices: { kind: 'fetch' as const, endpoint: 'elevenlabs-v2' as const },
  },
};

const ELEVEN_VOICES = [
  { id: 'cove', name: 'Cove', origin: 'own', gender: 'female', description: 'Calm and warm' },
  {
    id: 'raya',
    name: 'Raya – Loud and Reassuring',
    origin: 'predefined',
    gender: 'female',
    language: 'de',
    description: 'Bright announcer',
  },
  {
    id: 'max',
    name: 'Max',
    origin: 'predefined',
    gender: 'male',
    language: 'en',
    description: 'Deep Narrator',
  },
  { id: 'otto', name: 'Otto', origin: 'own', gender: 'male' },
];

function useEleven(voices: unknown[] = ELEVEN_VOICES, hiddenCount = 0): void {
  resolveTtsTransportMock.mockResolvedValue(ELEVEN_TRANSPORT);
  listTtsVoicesMock.mockResolvedValue({ voices, hiddenCount });
}

async function openPicker(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /pick voice/i }));
  await waitFor(() => expect(screen.queryByText('Loading voices…')).toBeNull());
}

function rowNames(): string[] {
  return ELEVEN_VOICES.filter((v) =>
    screen.queryByRole('button', { name: new RegExp(`^${v.name}`) }),
  ).map((v) => v.id);
}

describe('VoicePicker — search and filters', () => {
  it('shows search and filters only when voices carry metadata', async () => {
    useEleven();
    const { unmount } = render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(screen.getByRole('searchbox', { name: /search voices/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Own' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Female' })).toBeTruthy();
    unmount();

    // A Grok list carries no origin: it renders exactly as before.
    _resetVoiceListForTests();
    resolveTtsTransportMock.mockResolvedValue({
      ...STUB_TRANSPORT,
      offering: { providerId: 'xai', upstreamSlug: 'grok-tts' },
      ttsMeta: { ...STUB_TRANSPORT.ttsMeta, voices: { kind: 'fetch', endpoint: 'xai-flat' } },
    });
    listTtsVoicesMock.mockResolvedValue({ voices: [{ id: 'eve', name: 'Eve' }], hiddenCount: 0 });
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(screen.getByRole('button', { name: 'Eve' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('search matches name and description case-insensitively', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    const search = screen.getByRole('searchbox', { name: /search voices/i });

    fireEvent.change(search, { target: { value: 'cov' } });
    expect(rowNames()).toEqual(['cove']);

    fireEvent.change(search, { target: { value: 'NARRATOR' } });
    expect(rowNames()).toEqual(['max']);
  });

  it('the defaults are All and Any', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Any' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Own' })).toHaveAttribute('aria-selected', 'false');
    expect(rowNames()).toEqual(['cove', 'raya', 'max', 'otto']);
  });

  it('Own and Female filters combine', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Own' }));
    expect(rowNames()).toEqual(['cove', 'otto']);
    fireEvent.click(screen.getByRole('tab', { name: 'Female' }));
    expect(rowNames()).toEqual(['cove']);
    fireEvent.click(screen.getByRole('tab', { name: 'Predefined' }));
    expect(rowNames()).toEqual(['raya']);
    fireEvent.click(screen.getByRole('tab', { name: 'Male' }));
    expect(rowNames()).toEqual(['max']);
  });

  it('reopening resets search and filters', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cov' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Own' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Female' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await openPicker();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Any' })).toHaveAttribute('aria-selected', 'true');
    expect(rowNames()).toEqual(['cove', 'raya', 'max', 'otto']);
  });

  it('the search field is not autofocused', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(document.activeElement).not.toBe(screen.getByRole('searchbox'));
  });

  it('filter miss shows "No voice matches" and Clear search and filters restores the list', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No voice matches')).toBeTruthy();
    expect(rowNames()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.queryByText('No voice matches')).toBeNull();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(rowNames()).toEqual(['cove', 'raya', 'max', 'otto']);
  });

  it('empty account shows the ElevenLabs website hint', async () => {
    useEleven([]);
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(
      screen.getByText(
        'No voices on your ElevenLabs account yet — add them on the ElevenLabs website.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('No voice matches')).toBeNull();
  });

  it('each row shows an own pill and a language pill when set', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    const cove = screen.getByRole('button', { name: /^Cove/ });
    expect(within(cove).getByText('own')).toBeTruthy();
    const raya = screen.getByRole('button', { name: /^Raya/ });
    expect(within(raya).getByText('de')).toBeTruthy();
    expect(within(raya).queryByText('own')).toBeNull();
    const otto = screen.getByRole('button', { name: /^Otto/ });
    expect(within(otto).getByText('own')).toBeTruthy();
  });
});

describe('VoicePicker — hidden count line', () => {
  it('is absent at 0', async () => {
    useEleven(ELEVEN_VOICES, 0);
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(screen.queryByText(/hidden by our juvenile-voice rule/)).toBeNull();
  });

  it('uses the singular for one', async () => {
    useEleven(ELEVEN_VOICES, 1);
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(screen.getByText('1 voice hidden by our juvenile-voice rule')).toBeTruthy();
  });

  it('uses the plural for two, and stays while filtering', async () => {
    useEleven(ELEVEN_VOICES, 2);
    render(<VoicePicker label="Voice" value={null} onSelect={vi.fn()} />);
    await openPicker();
    expect(screen.getByText('2 voices hidden by our juvenile-voice rule')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('2 voices hidden by our juvenile-voice rule')).toBeTruthy();
  });
});

describe('VoicePicker — stale voice id', () => {
  const STALE_HINT = "This voice isn't available at ElevenLabs — choose a new one.";

  it('shows the choose-again hint naming the service once the list loaded', async () => {
    useEleven();
    render(<VoicePicker label="Voice" value="gone-voice" onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pick voice/i })).toHaveTextContent(STALE_HINT);
    });
    expect(screen.queryByText('gone-voice')).toBeNull();
  });

  it('on load error shows the error and Retry copy and no stale hint', async () => {
    resolveTtsTransportMock.mockResolvedValue(ELEVEN_TRANSPORT);
    listTtsVoicesMock.mockRejectedValue(new Error('network error'));
    render(<VoicePicker label="Voice" value="gone-voice" onSelect={vi.fn()} />);
    await openPicker();
    await waitFor(() => screen.getByText(/couldn't load the voice list/i));
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.queryByText(/isn't available at/)).toBeNull();
    expect(screen.getByRole('button', { name: /pick voice/i })).not.toHaveTextContent(
      /isn't available/,
    );
  });
});
