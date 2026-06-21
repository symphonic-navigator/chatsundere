import { describe, expect, it } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db.js';
import { compareByLastInteraction } from '../../src/data/personas.js';

const p = (id: string, createdAt: number, lastInteractionAt?: number): PersonaRow =>
  ({ id, createdAt, lastInteractionAt }) as PersonaRow;

describe('compareByLastInteraction', () => {
  it('orders most-recently-interacted first', () => {
    const list = [p('a', 100, 500), p('b', 200, 900), p('c', 300, 700)];
    expect(
      list
        .slice()
        .sort(compareByLastInteraction)
        .map((x) => x.id),
    ).toEqual(['b', 'c', 'a']);
  });
  it('falls back to createdAt when lastInteractionAt is unset', () => {
    const list = [p('old', 100), p('new', 400), p('used', 200, 999)];
    expect(
      list
        .slice()
        .sort(compareByLastInteraction)
        .map((x) => x.id),
    ).toEqual(['used', 'new', 'old']);
  });
});
