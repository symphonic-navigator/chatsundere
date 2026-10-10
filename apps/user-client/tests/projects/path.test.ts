// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isProjectFsError } from '../../src/projects/errors.js';
import {
  MAX_PATH_LENGTH,
  MAX_SEGMENT_LENGTH,
  basename,
  dirname,
  isHiddenPath,
  isUnder,
  normaliseFilePath,
  normalisePath,
  prefixRange,
  withMarkdownExtension,
} from '../../src/projects/path.js';

function reasonOf(fn: () => unknown): { code?: string; reason?: string } {
  try {
    fn();
  } catch (e) {
    if (isProjectFsError(e)) return { code: e.code, reason: e.detail.reason };
    throw e;
  }
  return {};
}

describe('normalisePath', () => {
  it.each([
    ['/a//b/', '/a/b'],
    ['/a/./b', '/a/b'],
    ['/a/b/../c', '/a/c'],
    ['/', '/'],
    ['/café.md', '/café.md'],
    ['/Notizen/Größe café 🎉 #1?.md', '/Notizen/Größe café 🎉 #1?.md'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });

  it.each([
    ['', 'InvalidPath', 'not-absolute'],
    ['a/b', 'InvalidPath', 'not-absolute'],
    ['/../x', 'EscapesRoot', undefined],
    ['/a/../../x', 'EscapesRoot', undefined],
    ['/a\u0007b', 'InvalidPath', 'control-character'],
    ['/a\u007fb', 'InvalidPath', 'control-character'],
    [`/${'a/'.repeat(600)}`, 'InvalidPath', 'too-long'],
    [`/${'a'.repeat(MAX_SEGMENT_LENGTH + 1)}`, 'InvalidPath', 'too-long'],
  ])('rejects %#', (input, code, reason) => {
    const got = reasonOf(() => normalisePath(input));
    expect(got.code).toBe(code);
    expect(got.reason).toBe(reason);
  });

  it('accepts the exact limits', () => {
    expect(normalisePath(`/${'a'.repeat(MAX_SEGMENT_LENGTH)}`)).toHaveLength(
      MAX_SEGMENT_LENGTH + 1,
    );
    const segs = [
      'b'.repeat(200),
      'b'.repeat(200),
      'b'.repeat(200),
      'b'.repeat(200),
      'b'.repeat(200),
    ];
    const p = `/${segs.join('/')}`;
    expect(p.length).toBeLessThanOrEqual(MAX_PATH_LENGTH);
    expect(normalisePath(p)).toBe(p);
  });
});

describe('normaliseFilePath', () => {
  it('accepts markdown files', () => {
    expect(normaliseFilePath('/notes//x.md')).toBe('/notes/x.md');
    expect(normaliseFilePath('/x.MARKDOWN')).toBe('/x.MARKDOWN');
  });
  it('refuses the root', () => {
    expect(reasonOf(() => normaliseFilePath('/'))).toEqual({ code: 'InvalidPath', reason: 'root' });
  });
  it.each(['/notes/x.txt', '/todo', '/.hidden'])('refuses %s', (input) => {
    expect(reasonOf(() => normaliseFilePath(input))).toEqual({
      code: 'InvalidPath',
      reason: 'extension',
    });
  });
});

describe('withMarkdownExtension', () => {
  it.each([
    ['/todo', '/todo.md'],
    ['/.hidden', '/.hidden.md'],
    ['/a.MD', '/a.MD'],
    ['/x.markdown', '/x.markdown'],
  ])('%j -> %j', (input, expected) => {
    expect(withMarkdownExtension(input)).toBe(expected);
  });
  it('refuses other extensions', () => {
    expect(reasonOf(() => withMarkdownExtension('/x.txt'))).toEqual({
      code: 'InvalidPath',
      reason: 'extension',
    });
  });
  it('refuses the root', () => {
    expect(reasonOf(() => withMarkdownExtension('/'))).toEqual({
      code: 'InvalidPath',
      reason: 'root',
    });
  });
});

describe('helpers', () => {
  it('dirname and basename', () => {
    expect(dirname('/a/b/c.md')).toBe('/a/b');
    expect(dirname('/c.md')).toBe('/');
    expect(dirname('/')).toBe('/');
    expect(basename('/a/b/c.md')).toBe('c.md');
    expect(basename('/')).toBe('');
  });
  it('isHiddenPath', () => {
    expect(isHiddenPath('/a/.git/x.md')).toBe(true);
    expect(isHiddenPath('/.x.md')).toBe(true);
    expect(isHiddenPath('/a/b.md')).toBe(false);
    expect(isHiddenPath('/')).toBe(false);
  });
  it('isUnder is a strict descendant test', () => {
    expect(isUnder('/a/x.md', '/a')).toBe(true);
    expect(isUnder('/a/b/x.md', '/a')).toBe(true);
    expect(isUnder('/ab.md', '/a')).toBe(false);
    expect(isUnder('/a-b/x.md', '/a')).toBe(false);
    expect(isUnder('/a', '/a')).toBe(false);
    expect(isUnder('/a.md', '/')).toBe(true);
    expect(isUnder('/', '/')).toBe(false);
  });
  it('prefixRange never uses the bare directory as prefix', () => {
    expect(prefixRange('/a')).toEqual(['/a/', '/a/￿']);
    expect(prefixRange('/')).toEqual(['/', '/￿']);
  });
});
