// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateMock = vi.fn();
let settingsRow: Record<string, unknown> | undefined;
let providerRows: Array<{ templateId: string; enabled: boolean; createdAt: number }>;

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsRow }),
  useUpdateSettings: () => ({ mutate: mutateMock, mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));

import { ImageGenerationSection } from '../../src/components/image-gen/ImageGenerationSection.js';

// xai requires the CORS proxy, so a configured proxy makes both providers usable.
const PROXY = { url: 'https://proxy.example', sharedKey: { version: 1 } };

function bothProviders() {
  providerRows = [
    { templateId: 'xai', enabled: true, createdAt: 1 },
    { templateId: 'nano-gpt', enabled: true, createdAt: 2 },
  ];
}

beforeEach(() => {
  mutateMock.mockClear();
  settingsRow = { corsProxy: PROXY, imageGeneration: { primary: null, nsfw: null } };
  bothProviders();
});

describe('ImageGenerationSection', () => {
  it('lists the TTI offerings of configured providers in the primary select', () => {
    render(<ImageGenerationSection />);
    expect(screen.getByRole('button', { name: /Grok Imagine/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Z-Image/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Seedream 4\.5/ })).toBeInTheDocument();
  });

  it('persists the picked offering with its default config and preserves the nsfw slot', () => {
    render(<ImageGenerationSection />);
    fireEvent.click(screen.getByRole('button', { name: /Seedream 4\.5/ }));
    expect(mutateMock).toHaveBeenCalledWith({
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:seedream-v4.5',
          config: { groupId: 'seedream', aspect: '1:1', quality: 'standard' },
        },
        nsfw: null,
      },
    });
  });

  it('merges a config change into the stored config without touching other fields', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:seedream-v4.5',
          config: { groupId: 'seedream', aspect: '16:9', quality: 'standard' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Ultra' }));
    expect(mutateMock).toHaveBeenCalledWith({
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:seedream-v4.5',
          config: { groupId: 'seedream', aspect: '16:9', quality: 'ultra' },
        },
        nsfw: null,
      },
    });
  });

  it('renders the closed-loop NSFW copy while no NSFW-capable model is curated', () => {
    render(<ImageGenerationSection />);
    expect(
      screen.getByText(
        'No NSFW-capable image model exists yet — this slot lights up automatically when one is curated. Nothing for you to do.',
      ),
    ).toBeInTheDocument();
  });

  it('offers no count control anywhere in the section', () => {
    render(<ImageGenerationSection />);
    expect(screen.queryByText(/count/i)).toBeNull();
    expect(screen.queryByLabelText(/count/i)).toBeNull();
  });

  it('shows the empty state and no offering buttons with zero TTI providers', () => {
    providerRows = [];
    render(<ImageGenerationSection />);
    expect(screen.getByText(/Upstream Providers/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grok Imagine/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Z-Image/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Seedream/ })).toBeNull();
  });

  it('renders without crashing when imageGeneration is undefined or stale', () => {
    settingsRow = { corsProxy: PROXY };
    const { unmount } = render(<ImageGenerationSection />);
    unmount();
    // A stale config (failing isImageModelConfig) renders as unset — never crashes.
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:seedream-v4.5',
          config: { groupId: 'seedream', aspect: 'bogus' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    expect(screen.queryByRole('button', { name: 'Ultra' })).toBeNull();
  });
});
