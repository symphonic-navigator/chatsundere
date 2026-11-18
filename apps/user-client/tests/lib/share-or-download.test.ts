// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const triggerDownload = vi.fn();
vi.mock('../../src/lib/download.js', () => ({ triggerDownload }));

const { deliverFile } = await import('../../src/lib/share-or-download.js');

const realMatchMedia = window.matchMedia;

function stubPointer(coarse: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
  })) as unknown as typeof window.matchMedia;
}

function stubShare(opts: {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title: string }) => Promise<void>;
}): { share: ReturnType<typeof vi.fn>; canShare: ReturnType<typeof vi.fn> } {
  const share = vi.fn(opts.share ?? (() => Promise.resolve()));
  const canShare = vi.fn(opts.canShare ?? (() => true));
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
  return { share, canShare };
}

const file = (): File => new File(['# Hi'], 'mira-chat-2026-11-14.md', { type: 'text/markdown' });

beforeEach(() => triggerDownload.mockReset());
afterEach(() => {
  window.matchMedia = realMatchMedia;
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
});

describe('deliverFile', () => {
  it('shares on a coarse pointer when the file can be shared', async () => {
    stubPointer(true);
    const { share } = stubShare({});
    const f = file();
    await expect(deliverFile(f, 'Trip planning')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [f], title: 'Trip planning' });
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it('calls share synchronously, inside the user gesture', () => {
    stubPointer(true);
    const { share } = stubShare({});
    void deliverFile(file(), 'T');
    expect(share).toHaveBeenCalledTimes(1);
  });

  it('retries as text/plain when text/markdown cannot be shared', async () => {
    stubPointer(true);
    const { share } = stubShare({ canShare: ({ files }) => files[0]?.type === 'text/plain' });
    await expect(deliverFile(file(), 'T')).resolves.toBe('shared');
    const shared = share.mock.calls[0]?.[0] as { files: File[] };
    expect(shared.files[0]?.type).toBe('text/plain');
    expect(shared.files[0]?.name).toBe('mira-chat-2026-11-14.md');
  });

  it('treats a cancelled share as silent', async () => {
    stubPointer(true);
    stubShare({ share: () => Promise.reject(new DOMException('cancelled', 'AbortError')) });
    await expect(deliverFile(file(), 'T')).resolves.toBe('cancelled');
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it('falls back to the download when sharing fails otherwise', async () => {
    stubPointer(true);
    stubShare({ share: () => Promise.reject(new DOMException('nope', 'NotAllowedError')) });
    const f = file();
    await expect(deliverFile(f, 'T')).resolves.toBe('downloaded');
    expect(triggerDownload).toHaveBeenCalledWith(f, f.name);
  });

  it('falls back to the download when share throws synchronously', async () => {
    stubPointer(true);
    stubShare({
      share: () => {
        throw new TypeError('bad');
      },
    });
    await expect(deliverFile(file(), 'T')).resolves.toBe('downloaded');
  });

  it('downloads when no format can be shared', async () => {
    stubPointer(true);
    const { share } = stubShare({ canShare: () => false });
    await expect(deliverFile(file(), 'T')).resolves.toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
  });

  it('downloads on a fine pointer even where sharing exists', async () => {
    stubPointer(false);
    const { share } = stubShare({});
    await expect(deliverFile(file(), 'T')).resolves.toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });

  it('downloads when the browser has no share API', async () => {
    stubPointer(true);
    await expect(deliverFile(file(), 'T')).resolves.toBe('downloaded');
  });

  it('rejects when the download itself fails', async () => {
    stubPointer(false);
    triggerDownload.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    await expect(deliverFile(file(), 'T')).rejects.toThrow('blocked');
  });
});
