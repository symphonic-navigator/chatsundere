import { beforeEach, describe, expect, it } from 'vitest';
import { clearLazyDraft, loadLazyDraft, saveLazyDraft } from '../../src/lib/cockpit-draft';

describe('lazy cockpit draft helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns "" when no draft saved', () => {
    expect(loadLazyDraft('p1')).toBe('');
  });

  it('save then load round-trips', () => {
    saveLazyDraft('p1', 'hello');
    expect(loadLazyDraft('p1')).toBe('hello');
  });

  it('drafts are keyed per persona', () => {
    saveLazyDraft('p1', 'one');
    saveLazyDraft('p2', 'two');
    expect(loadLazyDraft('p1')).toBe('one');
    expect(loadLazyDraft('p2')).toBe('two');
  });

  it('clear removes the entry', () => {
    saveLazyDraft('p1', 'gone');
    clearLazyDraft('p1');
    expect(loadLazyDraft('p1')).toBe('');
  });

  it('clear is a no-op when no entry exists', () => {
    expect(() => clearLazyDraft('never-set')).not.toThrow();
  });

  it('overwriting a draft keeps the latest value', () => {
    saveLazyDraft('p1', 'first');
    saveLazyDraft('p1', 'second');
    expect(loadLazyDraft('p1')).toBe('second');
  });
});
