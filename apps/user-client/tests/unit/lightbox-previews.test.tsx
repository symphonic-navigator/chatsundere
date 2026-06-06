// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HtmlPreview } from '../../src/components/lightbox/previews/HtmlPreview';
import { MarkdownDoc } from '../../src/components/lightbox/previews/MarkdownDoc';
import { SvgPreview } from '../../src/components/lightbox/previews/SvgPreview';

describe('SvgPreview', () => {
  it('renders the svg as a base64 data-uri image (no script execution path)', () => {
    const { container } = render(
      <SvgPreview content={'<svg xmlns="http://www.w3.org/2000/svg"/>'} />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('HtmlPreview', () => {
  it('renders a sandboxed iframe that cannot reach same-origin storage', () => {
    const { container } = render(<HtmlPreview content={'<p>hi</p>'} />);
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'");
  });
});

describe('MarkdownDoc', () => {
  it('renders markdown inside the document-grade container', () => {
    const { container } = render(<MarkdownDoc content={'# Title'} />);
    expect(container.querySelector('.lightbox-doc')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Title');
  });
});
