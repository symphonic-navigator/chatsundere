// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CapBadgeRow } from '../../src/components/CapBadgeRow.js';

describe('CapBadgeRow', () => {
  it('renders all five modality badges in order', () => {
    render(<CapBadgeRow lit={['llm']} />);
    for (const label of ['LLM', 'WEB', 'TTS', 'STT', 'TTI']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('marks lit modalities as on and others as off', () => {
    render(<CapBadgeRow lit={['llm']} />);
    expect(screen.getByText('LLM').getAttribute('data-lit')).toBe('true');
    expect(screen.getByText('WEB').getAttribute('data-lit')).toBe('false');
  });

  it('applies the tooltip for a greyed modality when provided', () => {
    render(
      <CapBadgeRow
        lit={['llm']}
        tooltipFor={(k) => (k === 'web' ? 'Add nano-gpt to unlock WEB' : 'Coming soon')}
      />,
    );
    expect(screen.getByText('WEB').getAttribute('title')).toBe('Add nano-gpt to unlock WEB');
    expect(screen.getByText('TTS').getAttribute('title')).toBe('Coming soon');
  });
});
