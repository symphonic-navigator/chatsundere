// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccordionCard } from '../../src/components/AccordionCard.js';

describe('AccordionCard scrollIntoView', () => {
  it('calls scrollIntoView when the accordion opens via click', () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView =
      scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(
        <AccordionCard icon="x" label="Section" meta="m">
          <p>hidden body</p>
        </AccordionCard>,
      );
      fireEvent.click(screen.getByText('Section'));
      expect(scrollSpy).toHaveBeenCalled();
      const call = scrollSpy.mock.calls[0]?.[0] as ScrollIntoViewOptions | undefined;
      expect(call?.behavior).toBe('smooth');
      expect(call?.block).toBe('nearest');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not call scrollIntoView on initial mount even with defaultOpen', () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView =
      scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(
        <AccordionCard icon="x" label="Section" meta="m" defaultOpen>
          <p>visible</p>
        </AccordionCard>,
      );
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not call scrollIntoView when the accordion closes', () => {
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView =
      scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
    try {
      render(
        <AccordionCard icon="x" label="Section" meta="m" defaultOpen>
          <p>visible</p>
        </AccordionCard>,
      );
      scrollSpy.mockClear();
      fireEvent.click(screen.getByText('Section'));
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
