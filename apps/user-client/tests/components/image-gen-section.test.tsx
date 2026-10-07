// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateMock = vi.fn();
let settingsRow: Record<string, unknown> | undefined;
let providerRows: Array<{
  templateId: string;
  enabled: boolean;
  createdAt: number;
  apiKey?: unknown;
}>;

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsRow }),
  useUpdateSettings: () => ({ mutate: mutateMock, mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../src/lib/server-gate.js', () => ({
  // xai requires the relay; an enabled 'proxy' gate makes it usable.
  useServerGate: () => ({ enabled: true, reason: null, tooltip: null }),
}));

import { ImageGenerationSection } from '../../src/components/image-gen/ImageGenerationSection.js';

const PROXY = { url: 'https://proxy.example', sharedKey: { version: 1 } };

function providers(...ids: string[]) {
  providerRows = ids.map((templateId, i) => ({
    templateId,
    enabled: true,
    createdAt: i,
    apiKey: {},
  }));
}

function lastPersisted(): { primary: Record<string, unknown> | null; nsfw: unknown } {
  const call = mutateMock.mock.calls.at(-1);
  if (!call) throw new Error('nothing persisted');
  return (
    call[0] as { imageGeneration: { primary: Record<string, unknown> | null; nsfw: unknown } }
  ).imageGeneration;
}

function primarySection(): HTMLElement {
  return screen.getByTestId('image-slot-primary');
}

beforeEach(() => {
  mutateMock.mockClear();
  settingsRow = { corsProxy: PROXY, imageGeneration: { primary: null, nsfw: null } };
  providers('xai', 'nano-gpt');
});

describe('ImageGenerationSection — picker', () => {
  it('shows one button per family, alphabetically', () => {
    render(<ImageGenerationSection />);
    const names = within(primarySection())
      .getAllByRole('button', {
        name: /^(FLUX\.3|GPT Image 2|Grok Imagine|MiniMax H3|Nano Banana 2\.1|Qwen Image|Seedream|Z-Image)$/,
      })
      .map((b) => b.textContent);
    expect(names).toEqual([
      'FLUX.3',
      'GPT Image 2',
      'Grok Imagine',
      'MiniMax H3',
      'Nano Banana 2.1',
      'Qwen Image',
      'Seedream',
      'Z-Image',
    ]);
  });

  it('a family tap persists its recommended variant with that variant defaults', () => {
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'Seedream' }));
    expect(lastPersisted().primary).toEqual({
      ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
      config: { aspect: '1:1', resolution: '2k', quality: null },
      lastConfigByRef: {
        'nano-gpt:bytedance/seedream-v5.0-flash': {
          aspect: '1:1',
          resolution: '2k',
          quality: null,
        },
      },
    });
  });

  it('greys out families whose provider is missing and explains on tap', () => {
    providers('xai');
    render(<ImageGenerationSection />);
    const flux = within(primarySection()).getByRole('button', { name: 'FLUX.3' });
    expect(flux).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(flux);
    expect(mutateMock).not.toHaveBeenCalled();
    expect(
      within(primarySection()).getByText(
        'FLUX.3 — nano-gpt is not set up — add it under Upstream Providers above.',
      ),
    ).toBeInTheDocument();
  });
});

describe('ImageGenerationSection — config view', () => {
  it('shows the identity line, a Variant row and priced resolutions', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
          config: { aspect: '1:1', resolution: '2k', quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(
      within(s).getByText('Seedream 5.0 Flash · nano-gpt · 2.7¢ per image'),
    ).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: '5.0 Lite' })).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: '2k · 2.7¢' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      within(s).getByText('Estimated price per image, billed by the provider.'),
    ).toBeInTheDocument();
  });

  it('hides single-choice rows; a flat price lives in the identity line', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:bytedance/seedream-v5.0-pro',
          config: { aspect: '1:1', resolution: null, quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(within(s).getByText('Seedream 5.0 Pro · nano-gpt · 9¢ per image')).toBeInTheDocument();
    expect(within(s).queryByText('Resolution')).toBeNull();
    expect(within(s).queryByText('Quality')).toBeNull();
  });

  it('quality buttons carry latency hints and resolution prices follow quality', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:xai/grok-imagine-image/v2.0/text-to-image',
          config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(within(s).getByRole('button', { name: 'Low · ~20 s' })).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: 'Medium · ~70 s' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(s).getByRole('button', { name: '2k · 8¢' })).toBeInTheDocument();
  });

  it('usage-billed prices carry a tilde', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:nano-banana-2.1',
          config: { aspect: '1:1', resolution: '1k', quality: 'minimal' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    expect(
      within(primarySection()).getByText('Nano Banana 2.1 · nano-gpt · ~6.1¢ per image'),
    ).toBeInTheDocument();
  });

  it('a config change merges into the slot and remembers it per offering', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
          config: { aspect: '1:1', resolution: '1k', quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: '16:9' }));
    expect(lastPersisted().primary).toEqual({
      ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
      config: { aspect: '16:9', resolution: '1k', quality: null },
      lastConfigByRef: {
        'nano-gpt:black-forest-labs/flux-3/text-to-image': {
          aspect: '16:9',
          resolution: '1k',
          quality: null,
        },
      },
    });
  });

  it('a variant switch carries over what fits', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:bytedance/seedream-v5.0-flash',
          config: { aspect: '16:9', resolution: '2k', quality: null },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: '5.0 Lite' }));
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:seedream-v5.0-lite',
      config: { aspect: '16:9', resolution: null, quality: null },
    });
  });

  it('coming back to an offering restores its remembered config', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:qwen-image-2.1/text-to-image',
          config: { aspect: '1:1', resolution: '1k', quality: null },
          lastConfigByRef: {
            'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '2k', quality: 'high' },
          },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'GPT Image 2' }));
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '16:9', resolution: '2k', quality: 'high' },
    });
  });

  it('a remembered config that no longer fits is ignored (carry-over instead)', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:qwen-image-2.1/text-to-image',
          config: { aspect: '16:9', resolution: '1k', quality: null },
          lastConfigByRef: {
            'nano-gpt:gpt-image-2': { aspect: '16:9', resolution: '8k', quality: 'ultra' },
          },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'GPT Image 2' }));
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:gpt-image-2',
      config: { aspect: '16:9', resolution: '1k', quality: 'medium' },
    });
  });
});

describe('ImageGenerationSection — stale and legacy slots', () => {
  it('a stale xAI slot stays visible, greyed, and a family tap moves to nano-gpt', () => {
    providers('nano-gpt');
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'xai:grok-imagine-image',
          config: { aspect: '1:1', resolution: '2k', quality: 'normal' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    const family = within(s).getByRole('button', { name: 'Grok Imagine' });
    expect(family).toHaveAttribute('aria-pressed', 'true');
    expect(family.classList.contains('opacity-50')).toBe(true);
    expect(
      within(s).getByRole('button', { name: 'Seedream' }).classList.contains('opacity-50'),
    ).toBe(false);
    const stale = within(s).getByRole('button', {
      name: '1 · xAI — xAI is not set up — add it under Upstream Providers above',
    });
    expect(stale).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(s).getByText(
        'Grok Imagine · xAI — xAI is not set up — add it under Upstream Providers above',
      ),
    ).toBeInTheDocument();
    fireEvent.click(family);
    expect(lastPersisted().primary).toMatchObject({
      ref: 'nano-gpt:xai/grok-imagine-image/v2.0/text-to-image',
    });
  });

  it('renders a legacy slot synced from an older device', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:seedream-v4.5',
          config: { groupId: 'seedream', aspect: '1:1', quality: 'high' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    expect(within(primarySection()).getByRole('button', { name: '2.2k · 4¢' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('renders a legacy Z-Image slot (variant moves into the ref) without crashing', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:z-image-turbo',
          config: { groupId: 'zimage', variant: 'base', size: '1536x1024' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    const s = primarySection();
    expect(within(s).getByRole('button', { name: 'Z-Image' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(s).getByText(/^Z-Image Base · nano-gpt/)).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: /^Base/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('the NSFW slot still says it lights up automatically', () => {
    render(<ImageGenerationSection />);
    expect(screen.getByText(/lights up automatically/)).toBeInTheDocument();
  });

  it('clearing the primary slot persists null and keeps the nsfw slot', () => {
    settingsRow = {
      corsProxy: PROXY,
      imageGeneration: {
        primary: {
          ref: 'nano-gpt:gpt-image-2',
          config: { aspect: '1:1', resolution: '1k', quality: 'medium' },
        },
        nsfw: null,
      },
    };
    render(<ImageGenerationSection />);
    fireEvent.click(within(primarySection()).getByRole('button', { name: 'Clear selection' }));
    expect(mutateMock).toHaveBeenCalledWith({ imageGeneration: { primary: null, nsfw: null } });
  });
});
