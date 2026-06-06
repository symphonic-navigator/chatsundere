// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LightboxTextBody } from '../../src/components/lightbox/LightboxTextBody';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item';

function item(over: Partial<ViewableItem>): ViewableItem {
  return {
    id: '1',
    kind: 'text',
    fileName: 'x',
    mime: '',
    text: '',
    caps: {
      rename: true,
      remove: false,
      copy: true,
      download: true,
      delete: false,
      editSource: false,
      editTags: false,
    },
    ...over,
  };
}

describe('LightboxTextBody dispatch', () => {
  it('renders markdown as a document', () => {
    const { container } = render(
      <LightboxTextBody
        item={item({ text: '# Hi', fileName: 'a.md' })}
        format="markdown"
        draft="# Hi"
        onDraftChange={() => {}}
      />,
    );
    expect(container.querySelector('.lightbox-doc h1')?.textContent).toBe('Hi');
  });
  it('renders svg as an image', () => {
    const { container } = render(
      <LightboxTextBody
        item={item({ text: '<svg/>', fileName: 'a.svg' })}
        format="svg"
        draft="<svg/>"
        onDraftChange={() => {}}
      />,
    );
    expect(container.querySelector('.lightbox-svg img')).not.toBeNull();
  });
  it('renders html in a sandboxed iframe', () => {
    const { container } = render(
      <LightboxTextBody
        item={item({ text: '<p>x</p>', fileName: 'a.html' })}
        format="html"
        draft="<p>x</p>"
        onDraftChange={() => {}}
      />,
    );
    expect(container.querySelector('iframe.lightbox-html')?.getAttribute('sandbox')).toBe(
      'allow-scripts',
    );
  });
});
