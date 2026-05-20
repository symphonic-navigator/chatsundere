// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { initialListFilter, reduceListFilter } from '../../src/routes/users/index.js';

describe('users list filter reducer', () => {
  it('sets search and resets page to 1', () => {
    const next = reduceListFilter(
      { ...initialListFilter, page: 3 },
      { type: 'search', value: 'al' },
    );
    expect(next.search).toBe('al');
    expect(next.page).toBe(1);
  });

  it('changes role filter and resets page', () => {
    const next = reduceListFilter(
      { ...initialListFilter, page: 3 },
      { type: 'role', value: 'admin' },
    );
    expect(next.role).toBe('admin');
    expect(next.page).toBe(1);
  });

  it('changes status filter and resets page', () => {
    const next = reduceListFilter(
      { ...initialListFilter, page: 3 },
      { type: 'status', value: 'suspended' },
    );
    expect(next.status).toBe('suspended');
    expect(next.page).toBe(1);
  });

  it('paginates without touching filters', () => {
    const next = reduceListFilter(
      { ...initialListFilter, search: 'al' },
      { type: 'page', value: 2 },
    );
    expect(next.page).toBe(2);
    expect(next.search).toBe('al');
  });
});
