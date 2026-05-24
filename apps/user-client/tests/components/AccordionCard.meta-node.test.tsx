// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccordionCard } from '../../src/components/AccordionCard.js';

describe('AccordionCard.meta', () => {
  it('accepts a ReactNode and renders embedded markup', () => {
    render(
      <AccordionCard
        icon="∿"
        label="Behavior"
        meta={
          <span>
            Temperature · <span data-testid="adult-flag">NSFW</span>
          </span>
        }
      >
        body
      </AccordionCard>,
    );
    expect(screen.getByTestId('adult-flag').textContent).toBe('NSFW');
  });

  it('still accepts a plain string for legacy callers', () => {
    render(
      <AccordionCard icon="∿" label="X" meta="just text">
        body
      </AccordionCard>,
    );
    expect(screen.getByText('just text')).toBeInTheDocument();
  });
});
