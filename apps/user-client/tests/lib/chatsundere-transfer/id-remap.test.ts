import { describe, expect, it } from 'vitest';
import { IdRemap } from '../../../src/lib/chatsundere-transfer/id-remap.js';

describe('IdRemap', () => {
  it('mints a stable new id per old id', () => {
    const r = new IdRemap();
    const a = r.fresh('old-1');
    expect(r.fresh('old-1')).toBe(a); // idempotent
    expect(r.fresh('old-2')).not.toBe(a);
    expect(a).not.toBe('old-1'); // genuinely fresh
  });
  it('maps known references and returns undefined for unknown/empty', () => {
    const r = new IdRemap();
    const a = r.fresh('old-1');
    expect(r.map('old-1')).toBe(a);
    expect(r.map('never-seen')).toBeUndefined();
    expect(r.map(null)).toBeUndefined();
    expect(r.map(undefined)).toBeUndefined();
  });
});
