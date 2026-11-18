// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { TRAIL_CAP, findReturnDepth, nextTrail } from '../../src/lib/nav-trail.js';

describe('nextTrail', () => {
  it('a push appends the previous pathname to the previous trail', () => {
    expect(nextTrail({ type: 'PUSH', prevTrail: ['/app'], prevPathname: '/app/settings' })).toEqual(
      ['/app', '/app/settings'],
    );
  });

  it('a replace inherits the replaced entry’s trail', () => {
    expect(
      nextTrail({ type: 'REPLACE', prevTrail: ['/app', '/app/circle'], prevPathname: '/x' }),
    ).toEqual(['/app', '/app/circle']);
  });

  it('a pop reads the entry’s stamp, or starts empty without one', () => {
    expect(nextTrail({ type: 'POP', stamp: ['/app'] })).toEqual(['/app']);
    expect(nextTrail({ type: 'POP', stamp: undefined })).toEqual([]);
  });

  it('ignores a malformed stamp', () => {
    expect(nextTrail({ type: 'POP', stamp: 'nope' as unknown as string[] })).toEqual([]);
    expect(nextTrail({ type: 'POP', stamp: ['/a', 3] as unknown as string[] })).toEqual([]);
  });

  it('keeps at most TRAIL_CAP pathnames, dropping the oldest', () => {
    const long = Array.from({ length: TRAIL_CAP }, (_, i) => `/p${i}`);
    const next = nextTrail({ type: 'PUSH', prevTrail: long, prevPathname: '/last' });
    expect(next).toHaveLength(TRAIL_CAP);
    expect(next[0]).toBe('/p1');
    expect(next.at(-1)).toBe('/last');
  });

  it('is never longer than the router’s idx', () => {
    expect(
      nextTrail({ type: 'PUSH', prevTrail: ['/a', '/b'], prevPathname: '/c', idx: 2 }),
    ).toEqual(['/b', '/c']);
    expect(nextTrail({ type: 'POP', stamp: ['/a', '/b'], idx: 0 })).toEqual([]);
  });
});

describe('findReturnDepth', () => {
  it('counts the steps back to the nearest matching entry', () => {
    expect(
      findReturnDepth(
        ['/app', '/app/settings', '/app/settings/providers'],
        '/app/settings/providers',
      ),
    ).toBe(1);
    expect(
      findReturnDepth(['/app', '/app/settings', '/app/settings/providers'], '/app/settings'),
    ).toBe(2);
  });

  it('matches by pathname, ignoring search and hash', () => {
    expect(findReturnDepth(['/app', '/app/persona/p1'], '/app/persona/p1?return=%2Fapp')).toBe(1);
    expect(findReturnDepth(['/app'], '/app#top')).toBe(1);
  });

  it('prefers the nearest entry when a pathname occurs twice', () => {
    expect(findReturnDepth(['/app/x', '/app', '/app/x', '/app/y'], '/app/x')).toBe(2);
  });

  it('returns null on a miss', () => {
    expect(findReturnDepth(['/app'], '/app/circle')).toBeNull();
    expect(findReturnDepth([], '/app')).toBeNull();
  });
});
