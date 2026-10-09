// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { type ProjectFsErrorCode, fsError, isProjectFsError } from '../../src/projects/errors.js';

describe('fsError', () => {
  it('builds the fixed messages', () => {
    expect(fsError('VersionConflict', { path: '/n.md', current: 'B', passed: 'A' }).message).toBe(
      'VersionConflict: /n.md is at version B, you passed A; re-read the file before writing.',
    );
    expect(fsError('NotFound', { path: '/n.md' }).message).toBe('NotFound: /n.md does not exist.');
    expect(fsError('AlreadyExists', { path: '/n.md' }).message).toBe(
      'AlreadyExists: /n.md already exists.',
    );
    expect(fsError('QuotaExceeded', {}).message).toBe(
      'QuotaExceeded: this device is out of space for projects; export a project to keep a copy, then free some space.',
    );
  });

  it('prefixes every message with its code and carries detail', () => {
    const codes: ProjectFsErrorCode[] = [
      'NotFound',
      'AlreadyExists',
      'VersionConflict',
      'InvalidPath',
      'EscapesRoot',
      'IsDirectory',
      'NotDirectory',
      'QuotaExceeded',
    ];
    for (const code of codes) {
      const e = fsError(code, { path: '/p', reason: 'root', current: 'B', passed: 'A' });
      expect(e.message.startsWith(`${code}: `)).toBe(true);
      expect(e.name).toBe('ProjectFsError');
      expect(e.code).toBe(code);
      expect(e.detail.path).toBe('/p');
    }
  });

  it('names path and reason for InvalidPath', () => {
    const m = fsError('InvalidPath', { path: '/x.txt', reason: 'extension' }).message;
    expect(m).toContain('/x.txt');
    expect(m).toContain('.md');
  });

  it('isProjectFsError narrows by code', () => {
    const e = fsError('NotFound', { path: '/a' });
    expect(isProjectFsError(e)).toBe(true);
    expect(isProjectFsError(e, 'NotFound')).toBe(true);
    expect(isProjectFsError(e, 'AlreadyExists')).toBe(false);
    expect(isProjectFsError(new Error('x'))).toBe(false);
    expect(isProjectFsError(null)).toBe(false);
  });
});
