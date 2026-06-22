// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useNavTransitionStore } from '../../src/state/nav-transition.store.js';

const rect = (x: number, y: number): DOMRect =>
  ({
    left: x,
    top: y,
    width: 10,
    height: 10,
    right: x + 10,
    bottom: y + 10,
    x,
    y,
    toJSON: () => ({}),
  }) as DOMRect;

describe('nav-transition store', () => {
  beforeEach(() => useNavTransitionStore.setState({ originRect: null, lastOrigin: null }));

  it('armFrom sets both originRect and lastOrigin', () => {
    const r = rect(5, 5);
    useNavTransitionStore.getState().armFrom(r, '/app');
    expect(useNavTransitionStore.getState().originRect).toBe(r);
    expect(useNavTransitionStore.getState().lastOrigin).toEqual({ rect: r, path: '/app' });
  });

  it('consume returns originRect and clears it (single-use)', () => {
    const r = rect(5, 5);
    useNavTransitionStore.getState().armFrom(r, '/app');
    expect(useNavTransitionStore.getState().consume()).toBe(r);
    expect(useNavTransitionStore.getState().originRect).toBeNull();
    expect(useNavTransitionStore.getState().consume()).toBeNull();
  });

  it('peekLast returns the {rect,path} without clearing (callable twice)', () => {
    const r = rect(7, 7);
    useNavTransitionStore.getState().armFrom(r, '/app');
    useNavTransitionStore.getState().consume(); // consume originRect as enter path does
    const first = useNavTransitionStore.getState().peekLast();
    expect(first).toEqual({ rect: r, path: '/app' });
    // second peek still returns the same value — no clearing
    const second = useNavTransitionStore.getState().peekLast();
    expect(second).toEqual({ rect: r, path: '/app' });
  });

  it('clearLast nulls lastOrigin', () => {
    const r = rect(3, 3);
    useNavTransitionStore.getState().armFrom(r, '/somewhere');
    useNavTransitionStore.getState().clearLast();
    expect(useNavTransitionStore.getState().lastOrigin).toBeNull();
    expect(useNavTransitionStore.getState().peekLast()).toBeNull();
  });
});
