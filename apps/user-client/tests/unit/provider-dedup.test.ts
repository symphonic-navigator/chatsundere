import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { pickProviderSurvivor } from '../../src/data/provider-dedup.js';

const base: Omit<ProviderRow, 'id' | 'enabled' | 'updatedAt'> = {
  templateId: 'nano-gpt',
  displayName: 'nano-gpt',
  baseUrl: '',
  apiKey: { version: 1, ciphertext: new Uint8Array(), nonce: new Uint8Array() },
  routing: { kind: 'direct' },
  createdAt: 0,
};
const row = (id: string, enabled: boolean, updatedAt: number): ProviderRow => ({
  ...base,
  id,
  enabled,
  updatedAt,
});

describe('pickProviderSurvivor', () => {
  it('prefers an enabled row over a disabled one regardless of updatedAt', () => {
    const enabledOld = row('a', true, 1);
    const disabledNew = row('b', false, 999);
    expect(pickProviderSurvivor([disabledNew, enabledOld]).id).toBe('a');
  });

  it('among same-enabled rows prefers the higher updatedAt', () => {
    expect(pickProviderSurvivor([row('a', true, 5), row('b', true, 9)]).id).toBe('b');
  });

  it('breaks a full tie by lexicographically smaller id (deterministic)', () => {
    expect(pickProviderSurvivor([row('zzz', true, 5), row('aaa', true, 5)]).id).toBe('aaa');
  });

  it('is order-independent', () => {
    const rows = [row('a', false, 5), row('b', true, 1), row('c', true, 9)];
    expect(pickProviderSurvivor([...rows].reverse()).id).toBe('c');
    expect(pickProviderSurvivor(rows).id).toBe('c');
  });
});
