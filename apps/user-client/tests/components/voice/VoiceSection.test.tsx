// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const updateMutate = vi.fn();

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { voiceMode: 'paragraph' } }),
  useUpdateSettings: () => ({ mutate: updateMutate }),
}));

// Provider row present by default; individual tests override.
const providerRowsMock = vi.fn().mockReturnValue({ data: [] });
vi.mock('../../../src/data/providers.js', () => ({
  useProviders: () => providerRowsMock(),
}));

// llm-unified TTS catalogue.
const listTtsOfferingsMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock('@chatsundere/llm-unified', () => ({
  listTtsOfferings: () => listTtsOfferingsMock(),
  getProvider: (id: string) => getProviderMock(id),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STUB_OFFERING = {
  providerId: 'mistral',
  upstreamSlug: 'voxtral-mini-tts-2603',
  serviceKind: 'tts',
  tts: { displayName: 'Voxtral Mini TTS', teal: 'strip' },
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
  listTtsOfferingsMock.mockReturnValue([STUB_OFFERING]);
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
