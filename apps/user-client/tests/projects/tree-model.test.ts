// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { FileMeta } from '../../src/projects/fs.js';
import { buildTree } from '../../src/projects/tree-model.js';

const f = (path: string): FileMeta => ({ id: path, path }) as unknown as FileMeta;

describe('buildTree', () => {
  it('nests files, puts directories first and sorts by code point', () => {
    const tree = buildTree([
      f('/b.md'),
      f('/notes/z.md'),
      f('/A.md'),
      f('/notes/sub/a.md'),
      f('/a.md'),
    ]);
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual([
      'dir:notes',
      'file:A.md',
      'file:a.md',
      'file:b.md',
    ]);
    const notes = tree[0];
    expect(notes?.children?.map((n) => n.path)).toEqual(['/notes/sub', '/notes/z.md']);
    expect(notes?.children?.[0]?.children?.[0]?.meta?.path).toBe('/notes/sub/a.md');
  });

  it('flags hidden files and directories', () => {
    const tree = buildTree([f('/.env.md'), f('/.cfg/a.md'), f('/x/.y.md'), f('/x/z.md')]);
    const by = (p: string) => JSON.stringify(tree).includes(`"path":"${p}","hidden":true`);
    expect(by('/.env.md')).toBe(true);
    expect(by('/.cfg')).toBe(true);
    expect(by('/.cfg/a.md')).toBe(true);
    expect(by('/x/.y.md')).toBe(true);
    expect(by('/x')).toBe(false);
    expect(by('/x/z.md')).toBe(false);
  });

  it('returns an empty tree for no files', () => {
    expect(buildTree([])).toEqual([]);
  });
});
