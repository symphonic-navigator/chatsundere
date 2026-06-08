// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Record every content HtmlPreview is rendered with, to expose any stale-draft lag:
// the iframe must never paint a neighbour's text on the freshly-selected item.
const htmlContents: string[] = [];
vi.mock('../../src/components/lightbox/previews/HtmlPreview', () => ({
  HtmlPreview: ({ content }: { content: string }) => {
    htmlContents.push(content);
    return <div data-testid="html-preview">{content}</div>;
  },
}));

import { Lightbox } from '../../src/components/lightbox/Lightbox';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

const editCaps = {
  rename: true,
  remove: false,
  copy: true,
  download: true,
  delete: false,
  editSource: true,
  editTags: false,
};
const html = (id: string): ViewableItem => ({
  id,
  kind: 'text',
  fileName: 'summer.html',
  mime: 'text/html',
  text: '<h1>HELLO SUMMER</h1>',
  caps: editCaps,
});
const md = (id: string): ViewableItem => ({
  id,
  kind: 'text',
  fileName: 'doc.md',
  mime: 'text/markdown',
  text: '# Doc',
  caps: editCaps,
});
const handlers = {
  onRename: () => {},
  onRemove: () => {},
  onEditText: () => {},
  onClose: () => {},
};

describe('Lightbox item switch resets the edit buffer synchronously', () => {
  it('never paints the HTML preview with a neighbour item content on navigate-back', () => {
    // Regression: the per-item draft reset used to run in an effect (one render late),
    // so the HTML artefact iframe mounted with the previous item's text and relied on a
    // flaky srcDoc-update reload — leaving the preview blank until a reopen.
    render(<Lightbox items={[html('h1'), md('m1')]} index={0} {...handlers} />);
    htmlContents.length = 0; // ignore the initial-open renders
    fireEvent.click(screen.getByLabelText('Next')); // -> md
    fireEvent.click(screen.getByLabelText('Previous')); // -> back to html
    expect(htmlContents.length).toBeGreaterThan(0);
    expect(htmlContents).not.toContain('# Doc');
    expect(htmlContents.every((c) => c.includes('HELLO SUMMER'))).toBe(true);
  });

  it('shows the newly selected item content in Source view immediately', () => {
    render(<Lightbox items={[md('m1'), html('h1')]} index={0} {...handlers} />);
    fireEvent.click(screen.getByText('Source'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Doc');
    fireEvent.click(screen.getByLabelText('Next')); // -> html
    fireEvent.click(screen.getByText('Source'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '<h1>HELLO SUMMER</h1>',
    );
  });
});
