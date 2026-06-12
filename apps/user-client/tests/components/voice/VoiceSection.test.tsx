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

// Provider row present by default; individual tests override.
const providerRowsMock = vi.fn().mockReturnValue({ data: [] });
vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => providerRowsMock(),
}));

// llm-unified TTS + STT catalogue.
const listTtsOfferingsMock = vi.fn();
const listSttOfferingsMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock('@chatsundere/llm-unified', () => ({
  listTtsOfferings: () => listTtsOfferingsMock(),
  listSttOfferings: () => listSttOfferingsMock(),
  getProvider: (id: string) => getProviderMock(id),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STUB_TTS_OFFERING = {
  providerId: 'mistral',
  upstreamSlug: 'voxtral-mini-tts-2603',
  serviceKind: 'tts',
  tts: { displayName: 'Voxtral Mini TTS', teal: 'strip' },
};

const STUB_STT_OFFERING = {
  providerId: 'mistral',
  upstreamSlug: 'voxtral-mini-stt-2603',
  serviceKind: 'stt',
  stt: { displayName: 'Voxtral Mini STT', contentModerated: false },
};

const STUB_PROVIDER_DEF = {
  id: 'mistral',
  displayName: 'Mistral AI',
};

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

beforeEach(() => {
  updateMutate.mockClear();
  useSettingsMock.mockReturnValue({
    data: {
      voiceMode: 'paragraph',
      dictationSensitivity: 'medium',
      dictationRedemptionMs: 1_728,
      dictationAutoSend: false,
    },
  });
  listTtsOfferingsMock.mockReturnValue([STUB_TTS_OFFERING]);
  listSttOfferingsMock.mockReturnValue([STUB_STT_OFFERING]);
  getProviderMock.mockReturnValue(STUB_PROVIDER_DEF);
  providerRowsMock.mockReturnValue({ data: [] });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VoiceSection — mode toggle', () => {
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

describe('VoiceSection — provider state line', () => {
  it('shows offering label when Mistral provider row is enabled', () => {
    providerRowsMock.mockReturnValue({
      data: [{ id: 'pr-1', templateId: 'mistral', enabled: true }],
    });
    setup();
    expect(screen.getByText(/voxtral mini tts via mistral ai/i)).toBeTruthy();
  });

  it('shows constructive add-provider hint when no enabled Mistral row exists', () => {
    // No provider rows — providerRowsMock already returns { data: [] } in beforeEach.
    setup();
    // The hint text spans multiple elements ("Add the", <span>Mistral AI</span>, "provider…"),
    // so query for the partial text in the surrounding paragraph.
    const hint = screen.getByText(/enable read-aloud/i);
    expect(hint).toBeTruthy();
    // The span for the provider name is a sibling of the text node.
    expect(hint.closest('p')?.textContent).toMatch(/Add the Mistral AI provider/i);
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
    useSettingsMock.mockReturnValueOnce({
      data: {
        voiceMode: 'paragraph',
        dictationSensitivity: 'medium',
        dictationRedemptionMs: 1_728,
        dictationAutoSend: true,
      },
    });
    setup();
    expect(
      screen.getByText(/each utterance sends immediately; there is no correction step/i),
    ).toBeTruthy();
  });
});

describe('VoiceSection — STT provider state line', () => {
  it('shows STT offering label when Mistral provider row is enabled', () => {
    providerRowsMock.mockReturnValue({
      data: [{ id: 'pr-1', templateId: 'mistral', enabled: true }],
    });
    setup();
    expect(screen.getByText(/voxtral mini stt via mistral ai/i)).toBeTruthy();
  });

  it('shows add-provider hint when no enabled STT provider row exists', () => {
    // providerRowsMock returns { data: [] } by default
    setup();
    // The hint spans multiple elements ("Add the", <span>Mistral AI</span>, "provider…");
    // match by the full textContent of the paragraph element.
    const hint = screen.getByText(
      (_content, element) =>
        element?.tagName === 'P' &&
        (element.textContent ?? '').includes(
          'Add the Mistral AI provider in My Settings to dictate',
        ),
    );
    expect(hint).toBeTruthy();
  });

  it('shows "No STT provider is curated yet." when listSttOfferings returns []', () => {
    listSttOfferingsMock.mockReturnValueOnce([]);
    setup();
    expect(screen.getByText(/no stt provider is curated yet/i)).toBeTruthy();
  });
});
