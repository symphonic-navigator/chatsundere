// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { copyText, downloadText } from '../../src/components/lightbox/lightbox-actions';

describe('copyText', () => {
  it('writes the text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyText('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
    vi.unstubAllGlobals();
  });
});

describe('downloadText', () => {
  it('creates and clicks an anchor with the right download name, then revokes', () => {
    const click = vi.fn();
    const createEl = vi.spyOn(document, 'createElement');
    const createUrl = vi.fn().mockReturnValue('blob:x');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    createEl.mockImplementation((tag: string) => {
      const el = Object.assign(document.createElementNS('http://www.w3.org/1999/xhtml', tag), {
        click,
      });
      return el as HTMLElement;
    });

    downloadText('print("hi")', 'app.py');

    const anchor = createEl.mock.results[0]?.value as HTMLAnchorElement;
    expect(anchor.getAttribute('download')).toBe('app.py');
    expect(click).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith('blob:x');
    createEl.mockRestore();
    vi.unstubAllGlobals();
  });
});
