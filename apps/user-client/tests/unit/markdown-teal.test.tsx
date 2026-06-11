// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from '../../src/components/chat/markdown/MarkdownContent.js';

describe('MarkdownContent — TEAL rendering', () => {
  it('renders inline tags as emoji', () => {
    render(<MarkdownContent text="Hello [laugh] there" />);
    expect(screen.getByText(/Hello 😄 there/)).toBeTruthy();
  });

  it('renders whisper as a classed span', () => {
    const { container } = render(<MarkdownContent text="a <whisper>secret</whisper> b" />);
    const span = container.querySelector('span.teal-whisper');
    expect(span?.textContent).toBe('secret');
  });

  it('leaves code blocks untouched', () => {
    const { container } = render(<MarkdownContent text={'```\n[laugh]\n```'} />);
    expect(container.textContent).toContain('[laugh]');
    expect(container.textContent).not.toContain('😄');
  });

  it('keeps unknown tags literal', () => {
    const { container } = render(<MarkdownContent text="see [snort] and [1]" />);
    expect(container.textContent).toContain('[snort]');
    expect(container.textContent).toContain('[1]');
  });
});
