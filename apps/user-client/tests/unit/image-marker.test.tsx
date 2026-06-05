// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageMarker } from '../../src/components/chat/markdown/ImageMarker';

describe('ImageMarker', () => {
  it('shows a tap-to-load pill (not an <img>) for a remote image, naming the host', () => {
    const { container } = render(<ImageMarker src="https://tracker.example/pixel.png" alt="" />);
    // No network-fetching <img> is in the DOM before consent.
    expect(container.querySelector('img')).toBeNull();
    const pill = container.querySelector('button.image-marker') as HTMLButtonElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('tracker.example');
    expect(pill.textContent).toMatch(/tap to load/i);
  });

  it('uses the alt text as the label when present', () => {
    const { container } = render(
      <ImageMarker src="https://cdn.example/cat.jpg" alt="a sleepy cat" />,
    );
    expect(container.querySelector('.image-marker-label')?.textContent).toBe('a sleepy cat');
  });

  it('tapping loads the image with no-referrer and no auto-expand bubbling', () => {
    const { container } = render(<ImageMarker src="https://cdn.example/cat.jpg" alt="cat" />);
    const pill = container.querySelector('button.image-marker') as HTMLButtonElement;
    fireEvent.click(pill);
    const img = container.querySelector('img.image-marker-img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://cdn.example/cat.jpg');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('a failed load surfaces a constructive error with an open-in-new-tab link', () => {
    const { container } = render(<ImageMarker src="https://cdn.example/missing.png" alt="" />);
    fireEvent.click(container.querySelector('button.image-marker') as HTMLButtonElement);
    const img = container.querySelector('img.image-marker-img') as HTMLImageElement;
    fireEvent.error(img);
    const err = container.querySelector('.image-marker--error') as HTMLElement;
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/couldn't load image/i);
    expect(err.textContent).toContain('cdn.example');
    const link = err.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://cdn.example/missing.png');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('treats a data: URI as embedded — no host, does not crash', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const { container } = render(<ImageMarker src={dataUri} alt="" />);
    const pill = container.querySelector('button.image-marker') as HTMLButtonElement;
    expect(pill.textContent).toContain('embedded image');
    expect(pill.textContent).toMatch(/tap to show/i);
    expect(container.querySelector('.image-marker-host')).toBeNull();
  });

  it('renders an inert marker when src is missing', () => {
    const { container } = render(<ImageMarker alt="orphan alt" />);
    expect(container.querySelector('button')).toBeNull();
    const marker = container.querySelector('.image-marker[data-empty="true"]') as HTMLElement;
    expect(marker.textContent).toContain('orphan alt');
  });

  it('refuses unsafe schemes — never loadable, never a clickable href', () => {
    for (const evil of [
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      const { container, unmount } = render(<ImageMarker src={evil} alt="x" />);
      // No tap-to-load button and no anchor — it falls back to an inert marker.
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('.image-marker[data-empty="true"]')).not.toBeNull();
      unmount();
    }
  });
});
