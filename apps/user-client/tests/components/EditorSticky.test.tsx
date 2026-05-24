// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorSticky } from '../../src/components/EditorSticky.js';

describe('EditorSticky', () => {
  it('renders its children', () => {
    render(
      <EditorSticky>
        <div>child-marker</div>
      </EditorSticky>,
    );
    expect(screen.getByText('child-marker')).toBeInTheDocument();
  });

  it('applies sticky-positioning classes', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('sticky');
    expect(wrapper.className).toContain('top-11');
    expect(wrapper.className).toContain('lg:top-14');
    expect(wrapper.className).toContain('z-10');
  });

  it('applies backdrop-blur + hairline border', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('backdrop-blur-sm');
    expect(wrapper.className).toContain('border-b');
  });

  it('extends across the px-4 route gutter via negative margin', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('-mx-4');
    expect(wrapper.className).toContain('px-4');
  });

  it('exposes a stable data-editor-sticky attribute for consumer tests', () => {
    const { container } = render(
      <EditorSticky>
        <div>x</div>
      </EditorSticky>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.dataset.editorSticky).toBe('');
  });
});
