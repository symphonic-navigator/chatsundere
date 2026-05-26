// SPDX-License-Identifier: AGPL-3.0-only
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { StreamingOrb } from '../../src/components/StreamingOrb';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

describe('StreamingOrb', () => {
  beforeEach(() => {
    useStreamManagerStore.setState({ streams: new Map() });
  });

  it('renders null when no stream for the persona', () => {
    const { container } = render(<StreamingOrb personaId="p1" colour="#abc" />);
    expect(container.querySelector('[data-streaming-orb]')).toBeNull();
  });

  it('renders the orb when a matching stream exists', () => {
    useStreamManagerStore.setState({
      streams: new Map([
        [
          'c1',
          {
            chatId: 'c1',
            personaId: 'p1',
            draftMessageId: 'd1',
            controller: new AbortController(),
            status: 'streaming',
            contentBuffer: [],
            pillBuffer: [],
            startedAt: 0,
          },
        ],
      ]),
    });
    const { container } = render(<StreamingOrb personaId="p1" colour="#abc" />);
    const orb = container.querySelector('[data-streaming-orb]') as HTMLElement;
    expect(orb).not.toBeNull();
    expect(orb.style.background).toContain('rgb(170, 187, 204)');
  });

  it('does not render when the live stream is for a different persona', () => {
    useStreamManagerStore.setState({
      streams: new Map([
        [
          'c1',
          {
            chatId: 'c1',
            personaId: 'OTHER',
            draftMessageId: 'd1',
            controller: new AbortController(),
            status: 'streaming',
            contentBuffer: [],
            pillBuffer: [],
            startedAt: 0,
          },
        ],
      ]),
    });
    const { container } = render(<StreamingOrb personaId="p1" colour="#abc" />);
    expect(container.querySelector('[data-streaming-orb]')).toBeNull();
  });
});
