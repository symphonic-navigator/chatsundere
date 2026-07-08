// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { resolveExportPassword } from '../../../src/lib/chatsundere-transfer/encryption-form.js';

describe('resolveExportPassword', () => {
  it('off → ok with no password', () => {
    expect(resolveExportPassword({ enabled: false, password: '', confirm: '' })).toEqual({
      ok: true,
      password: undefined,
    });
  });

  it('on + empty → blocked', () => {
    expect(resolveExportPassword({ enabled: true, password: '', confirm: '' }).ok).toBe(false);
  });

  it('on + mismatch → blocked', () => {
    const r = resolveExportPassword({ enabled: true, password: 'a', confirm: 'b' });
    expect(r).toMatchObject({ ok: false });
  });

  it('on + match → ok with the password', () => {
    expect(resolveExportPassword({ enabled: true, password: 'abc', confirm: 'abc' })).toEqual({
      ok: true,
      password: 'abc',
    });
  });
});
