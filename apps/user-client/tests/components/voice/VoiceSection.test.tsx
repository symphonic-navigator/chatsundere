// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const updateMutate = vi.fn();

const useSettingsMock = vi.fn();

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => useSettingsMock(),
  useUpdateSettings: () => ({ mutate: updateMutate }),
}));

// Provider rows absent by default; individual tests override.
const providerRowsMock = vi.fn().mockReturnValue({ data: [] });
vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => providerRowsMock(),
}));

// The llm-unified catalogue is deliberately NOT mocked: importing the real
// package registers the builtin providers, so the pickers list the genuine
// curated offerings (Grok TTS/STT, Voxtral STT) with their real metadata.

import { VoiceSection } from '../../../src/components/voice/VoiceSection.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoiceSection />
    </QueryClientProvider>,
  );
}

function settingsData(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      voiceMode: 'paragraph',
      dictationSensitivity: 'medium',
      dictationRedemptionMs: 1_728,
      dictationAutoSend: false,
      ttsOffering: null,
      sttOffering: null,
      ...overrides,
    },
  };
}

function providerRows(...templateIds: string[]) {
  return {
    data: templateIds.map((templateId, i) => ({
      id: `pr-${i}`,
      templateId,
      enabled: true,
    })),
  };
}

function openTtsPicker(): void {
  fireEvent.click(screen.getByRole('button', { name: /pick read-aloud voice/i }));
}

function openSttPicker(): void {
  fireEvent.click(screen.getByRole('button', { name: /pick speech-to-text/i }));
}

beforeEach(() => {
  updateMutate.mockClear();
  useSettingsMock.mockReturnValue(settingsData());
  providerRowsMock.mockReturnValue({ data: [] });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VoiceSection — mode toggle', () => {
  it('states that changes apply immediately (the section is not on the Save bar)', () => {
    setup();
    expect(screen.getByText(/changes apply\s*immediately/i)).toBeTruthy();
  });

  it('renders Paragraph and Sentence options', () => {
    setup();
    expect(screen.getByRole('button', { name: /paragraph/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sentence/i })).toBeTruthy();
  });

  it('Paragraph option has aria-pressed true by default (voiceMode=paragraph)', () => {
    setup();
    const para = screen.getByRole('button', { name: /paragraph/i });
    expect(para).toHaveAttribute('aria-pressed', 'true');
    const sent = screen.getByRole('button', { name: /sentence/i });
    expect(sent).toHaveAttribute('aria-pressed', 'false');
  });

  it('tapping Sentence fires update.mutate({ voiceMode: "sentence" })', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /sentence/i }));
    expect(updateMutate).toHaveBeenCalledWith({ voiceMode: 'sentence' });
  });

  it('tapping Paragraph fires update.mutate({ voiceMode: "paragraph" })', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /paragraph/i }));
    expect(updateMutate).toHaveBeenCalledWith({ voiceMode: 'paragraph' });
  });
});

describe('VoiceSection — Read-aloud voice slot picker', () => {
  it('lists exactly the two Grok entries — Mistral TTS is fully absent', () => {
    providerRowsMock.mockReturnValue(providerRows('xai', 'nano-gpt', 'mistral'));
    setup();
    openTtsPicker();
    const xaiRow = screen.getByRole('button', { name: /grok tts via xai/i });
    expect(xaiRow.textContent).toContain('Sends message text to xAI (US)');
    const nanoRow = screen.getByRole('button', { name: /grok tts via nano-gpt/i });
    expect(nanoRow.textContent).toContain('Sends message text via nano-gpt to xAI (US)');
    expect(screen.queryByText(/voxtral mini tts/i)).toBeNull();
  });

  it('shows the unconfigured copy and disabled Grok rows when only Mistral is configured', () => {
    providerRowsMock.mockReturnValue(providerRows('mistral'));
    setup();
    const trigger = screen.getByRole('button', { name: /pick read-aloud voice/i });
    expect(trigger.textContent).toContain('Add the xAI or nano-gpt provider to enable read-aloud.');
    openTtsPicker();
    const xaiRow = screen.getByText('Grok TTS via xAI').closest('[aria-disabled]');
    expect(xaiRow?.getAttribute('aria-disabled')).toBe('true');
    expect(xaiRow?.textContent).toContain('Add the xAI provider in My Settings to enable this.');
    const nanoRow = screen.getByText('Grok TTS via nano-gpt').closest('[aria-disabled]');
    expect(nanoRow?.getAttribute('aria-disabled')).toBe('true');
    expect(nanoRow?.textContent).toContain(
      'Add the nano-gpt provider in My Settings to enable this.',
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('shows the visible auto-default "Grok TTS via xAI (auto)" when xAI is enabled and the slot is null', () => {
    providerRowsMock.mockReturnValue(providerRows('xai'));
    setup();
    const trigger = screen.getByRole('button', { name: /pick read-aloud voice/i });
    expect(trigger.textContent).toContain('Grok TTS via xAI (auto)');
  });

  it('picking the nano-gpt entry persists ttsOffering and shows the slot-switch notice', () => {
    providerRowsMock.mockReturnValue(providerRows('xai', 'nano-gpt'));
    setup();
    expect(screen.queryByText(/personas keep their voice picks/i)).toBeNull();
    openTtsPicker();
    fireEvent.click(screen.getByRole('button', { name: /grok tts via nano-gpt/i }));
    expect(updateMutate).toHaveBeenCalledWith({ ttsOffering: 'nano-gpt:xai-tts' });
    expect(
      screen.getByText(
        /personas keep their voice picks — if a voice came from the previous provider, re-pick it in the persona editor/i,
      ),
    ).toBeTruthy();
  });
});

describe('VoiceSection — Speech-to-text slot picker', () => {
  it('lists all three STT entries with their egress notes', () => {
    providerRowsMock.mockReturnValue(providerRows('xai', 'nano-gpt', 'mistral'));
    setup();
    openSttPicker();
    const mistralRow = screen.getByRole('button', { name: /voxtral mini stt via mistral ai/i });
    expect(mistralRow.textContent).toContain('Sends microphone audio to Mistral AI (EU)');
    const xaiRow = screen.getByRole('button', { name: /grok stt via xai/i });
    expect(xaiRow.textContent).toContain('Sends microphone audio to xAI (US)');
    const nanoRow = screen.getByRole('button', { name: /grok stt via nano-gpt/i });
    expect(nanoRow.textContent).toContain('Sends microphone audio via nano-gpt to xAI (US)');
  });

  it('shows the Mistral-first auto-default and persists an explicit xAI pick without a switch note', () => {
    providerRowsMock.mockReturnValue(providerRows('xai', 'mistral'));
    setup();
    const trigger = screen.getByRole('button', { name: /pick speech-to-text/i });
    expect(trigger.textContent).toContain('Voxtral Mini STT via Mistral AI (auto)');
    openSttPicker();
    fireEvent.click(screen.getByRole('button', { name: /grok stt via xai/i }));
    expect(updateMutate).toHaveBeenCalledWith({ sttOffering: 'xai:grok-stt' });
    expect(screen.queryByText(/personas keep their voice picks/i)).toBeNull();
  });
});

describe('VoiceSection — moderation notice follows the selected offering', () => {
  it('is absent when the slot auto-resolves to an unmoderated Grok path', () => {
    providerRowsMock.mockReturnValue(providerRows('xai'));
    setup();
    expect(screen.queryByText(/content moderation/i)).toBeNull();
  });

  it('appears when the persisted ref points at a content-moderated offering', () => {
    // A legacy pre-removal pick of Mistral Voxtral TTS still resolves while its
    // provider is configured — the mechanism keys off the SELECTED offering.
    providerRowsMock.mockReturnValue(providerRows('mistral'));
    useSettingsMock.mockReturnValue(settingsData({ ttsOffering: 'mistral:voxtral-mini-tts-2603' }));
    setup();
    expect(screen.getByText(/applies content moderation/i)).toBeTruthy();
  });
});

describe('VoiceSection — dictation sensitivity', () => {
  it('renders a Dictation heading', () => {
    setup();
    expect(screen.getByText(/^dictation$/i)).toBeTruthy();
  });

  it('renders three sensitivity option buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: /quiet speech/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /balanced/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /background noise/i })).toBeTruthy();
  });

  it('medium option has aria-pressed true when dictationSensitivity is medium', () => {
    setup();
    const medium = screen.getByRole('button', { name: /balanced/i });
    expect(medium).toHaveAttribute('aria-pressed', 'true');
    const low = screen.getByRole('button', { name: /quiet speech/i });
    expect(low).toHaveAttribute('aria-pressed', 'false');
    const high = screen.getByRole('button', { name: /background noise/i });
    expect(high).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking high fires update.mutate({ dictationSensitivity: "high" })', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /background noise/i }));
    expect(updateMutate).toHaveBeenCalledWith({ dictationSensitivity: 'high' });
  });
});

describe('VoiceSection — pause tolerance slider', () => {
  it('renders a range input with min 576, max 11520', () => {
    setup();
    const slider = screen.getByRole('slider', { name: /pause tolerance/i });
    expect(slider).toHaveAttribute('min', '576');
    expect(slider).toHaveAttribute('max', '11520');
  });

  it('slider reflects dictationRedemptionMs value', () => {
    setup();
    const slider = screen.getByRole('slider', { name: /pause tolerance/i });
    expect(slider).toHaveAttribute('value', '1728');
  });

  it('changing slider fires update.mutate({ dictationRedemptionMs: <value> })', () => {
    setup();
    const slider = screen.getByRole('slider', { name: /pause tolerance/i });
    fireEvent.change(slider, { target: { value: '3456' } });
    expect(updateMutate).toHaveBeenCalledWith({ dictationRedemptionMs: 3_456 });
  });
});

describe('VoiceSection — auto-send toggle', () => {
  it('auto-send button has aria-pressed false when dictationAutoSend is false', () => {
    setup();
    const btn = screen.getByRole('button', { name: /auto-send/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking auto-send fires update.mutate({ dictationAutoSend: true })', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /auto-send/i }));
    expect(updateMutate).toHaveBeenCalledWith({ dictationAutoSend: true });
  });

  it('eyes-open note is NOT visible when auto-send is off', () => {
    setup();
    expect(screen.queryByText(/each utterance sends immediately/i)).toBeNull();
  });

  it('eyes-open note IS visible when dictationAutoSend is true', () => {
    useSettingsMock.mockReturnValueOnce(settingsData({ dictationAutoSend: true }));
    setup();
    expect(
      screen.getByText(/each utterance sends immediately; there is no correction step/i),
    ).toBeTruthy();
  });
});
